// api/paystack-webhook-proxy.js  (temporary debug)
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
export const config = { api: { bodyParser: false } };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
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
    console.error('PAYSTACK_SECRET not set (debug)');
    return false;
  }
  const hash = crypto.createHmac('sha512', PAYSTACK_SECRET).update(rawBuffer).digest('hex');
  return signature === hash;
}

export default async function handler(req, res) {
  try {
    console.log('DEBUG ENV_PRESENT', {
      SUPABASE_URL: !!SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: !!SUPABASE_SERVICE_ROLE_KEY,
      PAYSTACK_SECRET: !!PAYSTACK_SECRET
    });

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const raw = await getRawBody(req);
    const signature = req.headers['x-paystack-signature'] || req.headers['X-Paystack-Signature'];

    if (!verifyPaystackSignature(raw, signature)) {
      console.log('signature invalid (debug)');
      return res.status(401).json({ error: 'invalid signature (debug)' });
    }

    let payload;
    try { payload = JSON.parse(raw.toString('utf8')); } catch (e) {
      return res.status(400).json({ error: 'invalid json', details: String(e) });
    }

    // Try to run the exact DB inserts inside a try/catch and surface any error
    try {
      // minimal test insert (no schema assumptions): insert into processed_events only if column exists
      const insertObj = {
        event_id: payload.id || `${payload.event}-${payload.data?.reference || 'no-ref'}`,
        // attempt common fields; missing columns will cause an error we'll catch
        event_name: payload.event || null,
        reference: payload?.data?.reference || null,
        status: payload?.data?.status || null,
        payload
      };
      const { data, error } = await supabase.from('processed_events').insert(insertObj, { returning: 'representation' });
      if (error) throw error;
      return res.status(200).json({ ok: true, debug: { inserted_processed_event: Array.isArray(data) ? data[0] : data } });
    } catch (dbErr) {
      console.error('DB OP ERROR (debug)', dbErr);
      // return a sanitized error and short stack
      return res.status(500).json({
        ok: false,
        error: String(dbErr.message || dbErr),
        hint: 'db operation failed, check table columns/schemas',
        stack: (dbErr?.stack || '').split('\n').slice(0,6)
      });
    }
  } catch (err) {
    console.error('HANDLER_CRASH_DEBUG', err);
    return res.status(500).json({ ok: false, error: String(err), stack: (err.stack||'').split('\n').slice(0,6) });
  }
}
