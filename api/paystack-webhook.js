/**
 * Paystack webhook skeleton.
 * - Validates Paystack signature using PAYSTACK_SECRET_KEY
 * - Logs the event to console (we'll save to DB in Milestone 2)
 *
 * IMPORTANT: set PAYSTACK_SECRET_KEY in Vercel env
 */

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function verifyPaystackSignature(bodyRaw, signatureHeader) {
  // Paystack uses HMAC-SHA512 of body with secret key and sends signature in header.
  // In serverless environments, you must access the raw body bytes. Vercel Node
  // provides the body already parsed — to keep this starter simple we will do a
  // best-effort verification if signature header is missing we will log and reject.
  // When moving to production, use raw body verification (see Paystack docs).
  return !!signatureHeader; // placeholder check — replace with proper HMAC check in Milestone 2
}

export default async function handler(req, res) {
  const signature = req.headers["x-paystack-signature"] || req.headers["paystack-signature"];
  // NOTE: Vercel parses JSON body automatically. For HMAC verification we need raw body.
  // We'll log the request and return 200 for now. Later we'll implement real verification.
  if (!verifyPaystackSignature(req.body, signature)) {
    console.warn("Paystack signature verification failed (placeholder).");
    return res.status(400).send("invalid signature");
  }

  console.log("Received Paystack webhook:", JSON.stringify(req.body).slice(0, 2000));

  // TODO: persist event to payment_events table and process idempotently.
  return res.status(200).send("ok");
}
