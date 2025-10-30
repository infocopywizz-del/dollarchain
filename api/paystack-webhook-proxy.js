// api/paystack-webhook-proxy.js
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

export const config = { api: { bodyParser: false } };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// Accept either PAYSTACK_SECRET or PAYSTACK_SECRET_KEY so we don't break existing env names
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET ?? process.env.PAYSTACK_SECRET_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function verifyPaystackSignature(rawBuffer, signature) {
  if (!signature) return false;
  if (!PAYSTACK_SECRET) {
    // avoid crash if secret missing; log for debugging
    console.error('verifyPaystackSignature: PAYSTACK_SECRET not configured');
    return false;
  }
  const hash = crypto.createHmac('sha512', PAYSTACK_SECRET).update(rawBuffer).digest('hex');
  return signature === hash;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const raw = await getRawBody(req); // Buffer
  const signature = req.headers['x-paystack-signature'] || req.headers['X-Paystack-Signature'];

  if (!verifyPaystackSignature(raw, signature)) {
    return res.status(401).json({ error: 'invalid signature' });
  }

  let payload;
  try { payload = JSON.parse(raw.toString('utf8')); } catch (e) {
    return res.status(400).json({ error: 'invalid json' });
  }

  // --- idempotency key & basic extractors ---
  const eventId = payload.id || payload.event || `${payload.event}-${payload.data?.reference || 'no-ref'}`;
  const reference = payload?.data?.reference || null;
  const eventName = payload.event || payload?.event_name || null;
  const status = payload?.data?.status || null;

  const processed_event_id = eventId;

  // attempt to insert processed_events; if exists, treat as duplicate
  try {
    await supabase
      .from('processed_events')
      .insert({
        event_id: processed_event_id,
        event_name: eventName,
        reference,
        status,
        payload
      }, { returning: 'minimal' });
  } catch (err) {
    // if unique constraint violation -> duplicate; return success to Paystack
    const msg = (err?.message || '').toLowerCase();
    if (msg.includes('duplicate') || msg.includes('unique')) {
      return res.status(200).json({ ok: true, message: 'duplicate' });
    }
    console.error('processed_events insert error', err);
    return res.status(500).json({ error: 'internal' });
  }

  // find order by reference
  let orderId = null;
  try {
    const { data: orderRows } = await supabase
      .from('orders')
      .select('id, client_id, credits, amount')
      .eq('paystack_reference', reference)
      .limit(1);

    if (orderRows && orderRows.length) orderId = orderRows[0].id;
  } catch (e) {
    console.error('order lookup error', e);
  }

  // fallback: look into payment_events if order not found
  if (!orderId) {
    try {
      const { data: pe } = await supabase
        .from('payment_events')
        .select('order_id')
        .eq('reference', reference)
        .limit(1);
      if (pe && pe.length) orderId = pe[0].order_id;
    } catch (e) {
      console.error('payment_events lookup error', e);
    }
  }

  // if still no order, queue for retry and log payment_event
  if (!orderId) {
    await supabase.from('webhook_retry_queue').upsert({
      event_id: processed_event_id,
      event_name,
      reference,
      payload,
      last_attempt_at: new Date().toISOString()
    }, { onConflict: 'event_id' });

    await supabase.from('payment_events').insert({
      event_id: processed_event_id,
      reference,
      event_name: eventName,
      status,
      payload,
      order_id: null
    });

    return res.status(202).json({ ok: true, queued: true });
  }

  // we have an order: increment client credits safely
  try {
    // fetch order and client
    const { data: orderRows2 } = await supabase
      .from('orders')
      .select('id, client_id, credits, amount')
      .eq('id', orderId)
      .limit(1);
    const ord = orderRows2[0];

    const { data: clientRows } = await supabase
      .from('clients')
      .select('id, credits')
      .eq('id', ord.client_id)
      .limit(1);
    const client = clientRows[0];
    const creditsToAdd = ord.credits || Math.round((payload?.data?.amount || ord.amount || 0) / 100);

    const balanceBefore = client?.credits || 0;
    const balanceAfter = balanceBefore + creditsToAdd;

    // update credits
    await supabase.from('clients').update({ credits: balanceAfter }).eq('id', client.id);

    // write audit log
    await supabase.from('credit_logs').insert({
      client_id: client.id,
      order_id: ord.id,
      credits_delta: creditsToAdd,
      balance_before: balanceBefore,
      balance_after: balanceAfter,
      source: 'paystack_webhook_proxy',
      reference,
      processed_event_id,
      meta: { raw_payload: payload }
    });

    // record payment_event
    await supabase.from('payment_events').insert({
      event_id: processed_event_id,
      reference,
      event_name: eventName,
      status,
      payload,
      order_id: ord.id
    });

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('error processing order/credits', e);
    return res.status(500).json({ error: 'processing_failed' });
  }
}
