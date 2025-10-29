// webhook-handler.js
// Usage: mount as an Express route. Use bodyParser.raw({ type: '*/*' }) before this handler.

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // service_role only on server
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function verifyPaystackSignature(rawBodyBuffer, signature) {
  if (!signature) return false;
  const hash = crypto.createHmac('sha512', PAYSTACK_SECRET)
                     .update(rawBodyBuffer)
                     .digest('hex');
  // Paystack sends lowercase hex; compare constant-time:
  return signature === hash;
}

// Helper: robustly extract event id/reference/status from payload
function extractIdentifiers(payload) {
  // payload structure varies: the root might include "id" or "event"; data sometimes nested.
  const eventId = payload.id || payload.event_id || payload.data?.id || payload.data?.transaction?.id || payload.data?.reference || null;
  const reference = payload.data?.reference || payload.data?.transaction?.reference || payload.data?.trxref || payload.reference || null;
  const eventName = payload.event || payload.event_name || null;
  const status = payload.data?.status || payload.data?.transaction?.status || null;
  return { eventId, reference, eventName, status };
}

async function findOrderId(reference, payload) {
  // 3-tier lookup:
  // 1) orders.paystack_reference = reference
  // 2) payment_events table entries with reference -> order_id
  // 3) metadata inside payload (if you store order info there)
  if (!reference) return null;

  // 1) search orders table
  let { data: orderRows, error } = await supabase
    .from('orders')
    .select('id')
    .eq('paystack_reference', reference)
    .limit(1);

  if (!error && orderRows?.length) return orderRows[0].id;

  // 2) search payment_events table which may include order_id
  let { data: peRows, error: peErr } = await supabase
    .from('payment_events')
    .select('order_id')
    .eq('reference', reference)
    .limit(1);

  if (!peErr && peRows?.length && peRows[0].order_id) return peRows[0].order_id;

  // 3) check payload metadata
  const metaOrderId =
    payload?.data?.metadata?.order_id ||
    payload?.data?.metadata?.orderId ||
    payload?.data?.metadata?.order ||
    null;

  return metaOrderId || null;
}

async function insertProcessedEventIfNew(eventId, row) {
  // Try to insert; if event_id exists, we treat as already-processed and return false
  // Supabase upsert with onConflict can help; here we attempt insert and check error for conflict
  const { data, error } = await supabase
    .from('processed_events')
    .insert(row, { returning: 'minimal' }); // minimal is faster

  if (error) {
    // If unique violation (already exists), treat as duplicate.
    const isConflict = /unique|duplicate|already exists/i.test(error.message || '');
    if (isConflict) return false;
    throw error;
  }
  return true;
}

async function queueForRetry(eventId, eventName, reference, payload) {
  await supabase.from('webhook_retry_queue').upsert({
    event_id: eventId,
    event_name: eventName,
    reference,
    payload,
    last_attempt_at: new Date().toISOString()
  }, { onConflict: 'event_id' });
}

module.exports = async function paystackWebhookHandler(req, res) {
  try {
    // rawBody must be available; Express must use bodyParser.raw({type: '*/*'})
    const raw = req.body; // buffer
    const signature = req.get('x-paystack-signature') || req.get('x-paystack-signature'.toUpperCase());

    if (!verifyPaystackSignature(raw, signature)) {
      console.warn('Paystack signature mismatch');
      return res.status(401).send({ error: 'invalid signature' });
    }

    const payloadText = raw.toString('utf8');
    let payload;
    try { payload = JSON.parse(payloadText); } catch (e) {
      console.error('invalid json payload', e);
      return res.status(400).send({ error: 'invalid payload' });
    }

    const { eventId, reference, eventName, status } = extractIdentifiers(payload);
    const processedRow = {
      event_id: eventId || `${eventName}-${reference || 'no-ref'}-${Date.now()}`,
      event_name: eventName || payload.event || 'unknown',
      reference: reference || null,
      status: status || null,
      payload: payload
    };

    // Idempotency: if processed_events has this event_id, stop here.
    const inserted = await insertProcessedEventIfNew(processedRow);
    if (!inserted) {
      console.info('Duplicate webhook event received. Skipping processing.', processedRow.event_id);
      return res.status(200).send({ ok: true, message: 'duplicate' });
    }

    // Attempt to find order_id
    const orderId = await findOrderId(reference, payload);

    // Record payment_event (if you want to keep a normalized payment_events table)
    // Adapt columns to your schema (status/amount/client_id etc.)
    try {
      const paymentEventRecord = {
        event_id: processedRow.event_id,
        reference: reference || null,
        event_name: processedRow.event_name,
        status: processedRow.status,
        payload: payload,
        order_id: orderId || null,
        created_at: new Date().toISOString()
      };
      await supabase.from('payment_events').insert(paymentEventRecord);
    } catch (err) {
      console.error('failed to insert payment_events', err.message || err);
      // don't abort; we keep going but log it.
    }

    if (!orderId) {
      // Can't attach order now — queue for retry and return 202 accepted.
      console.warn('order_id not found; queueing for retry', { reference, eventId: processedRow.event_id });
      await queueForRetry(processedRow.event_id, processedRow.event_name, reference, payload);
      return res.status(202).send({ ok: true, queued: true });
    }

    // If we have an order, obtain its client_id and credit amount (adjust to your schema)
    const { data: orderRows, error: orderErr } = await supabase
      .from('orders')
      .select('id, client_id, amount, credits')
      .eq('id', orderId)
      .limit(1);

    if (orderErr || !orderRows?.length) {
      console.error('order lookup unexpectedly failed after initial find', orderErr);
      // Put into retry queue
      await queueForRetry(processedRow.event_id, processedRow.event_name, reference, payload);
      return res.status(202).send({ ok: true, queued: true });
    }

    const order = orderRows[0];
    const clientId = order.client_id;

    // Determine credits to add: prioritize
    // - payment amount to credits mapping (if you record `order.credits`), else infer
    const creditsToAdd = order.credits || payload?.data?.metadata?.credits || Math.round((payload?.data?.amount || order.amount || 0) / 100) || 0;

    // Update client credits safely: we rely on processed_events uniqueness to avoid duplicate increments.
    // Fetch current balance, update, then insert credit_log
    const { data: clientRows, error: clientErr } = await supabase
      .from('clients')
      .select('id, credits')
      .eq('id', clientId)
      .limit(1);

    if (clientErr || !clientRows?.length) {
      console.error('client not found for order', clientErr);
      await queueForRetry(processedRow.event_id, processedRow.event_name, reference, payload);
      return res.status(202).send({ ok: true, queued: true });
    }

    const currentBalance = clientRows[0].credits || 0;
    const newBalance = currentBalance + creditsToAdd;

    // Perform update
    const { data: updateData, error: updateErr } = await supabase
      .from('clients')
      .update({ credits: newBalance })
      .eq('id', clientId);

    if (updateErr) {
      console.error('error updating client credits', updateErr);
      // Retry later
      await queueForRetry(processedRow.event_id, processedRow.event_name, reference, payload);
      return res.status(202).send({ ok: true, queued: true });
    }

    // Insert credit log
    try {
      await supabase.from('credit_logs').insert({
        client_id: clientId,
        order_id: orderId,
        credits_delta: creditsToAdd,
        balance_before: currentBalance,
        balance_after: newBalance,
        source: 'paystack_webhook',
        reference,
        processed_event_id: processedRow.event_id,
        meta: { raw: payload }
      });
    } catch (err) {
      console.error('failed to insert credit_log', err);
      // credit already applied; we have processed_events to prevent duplication, so return success.
    }

    // Success
    return res.status(200).send({ ok: true });
  } catch (err) {
    console.error('Unhandled error in webhook handler', err);
    return res.status(500).send({ error: 'internal error' });
  }
};
