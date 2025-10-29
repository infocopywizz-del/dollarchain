// api/start-mpesa-charge.js
import { supabaseServer } from "../lib/supabaseServer.js";

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const DEFAULT_CURRENCY = "KES"; // Kenya

function genReference() {
  return `dc-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

/**
 * Normalize Kenyan phone numbers to the form: 2547XXXXXXXX
 * Accepts:
 *  - 07XXXXXXXX
 *  - 7XXXXXXXX
 *  - +2547XXXXXXXX
 *  - 2547XXXXXXXX
 */
function normalizeKenyanPhone(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  // remove spaces, dashes, parentheses
  s = s.replace(/[\s\-()]/g, "");
  // strip leading +
  if (s.startsWith("+")) s = s.slice(1);
  // If starts with 0 (e.g., 07...), drop leading 0 and prefix 254
  if (/^0[7|1]\d{8}$/.test(s)) {
    return "254" + s.slice(1);
  }
  // If starts with 7 and 9 digits (7XXXXXXXX)
  if (/^7\d{8}$/.test(s)) {
    return "254" + s;
  }
  // If already starts with 254 and 12 digits
  if (/^254\d{9}$/.test(s)) {
    return s;
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const { client_id, amount, phone, credits, email } = body || {};

  // Validate inputs
  if (!client_id) return res.status(400).json({ error: "missing_client_id" });
  if (!phone) return res.status(400).json({ error: "missing_phone" });
  if (!Number.isFinite(Number(amount))) return res.status(400).json({ error: "missing_amount" });
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: "paystack_not_configured" });

  // Normalize and validate phone
  const normalized = normalizeKenyanPhone(phone);
  if (!normalized) {
    return res.status(400).json({
      error: "invalid_phone_format",
      note: "Provide Kenyan phone as 07XXXXXXXX or 2547XXXXXXXX or +2547XXXXXXXX"
    });
  }

  const amountCents = Number(amount); // smallest unit (e.g., KES * 100 for cents)
  const reference = genReference();

  // 1) Insert pending order (amount_cents expected by your schema)
  try {
    const { data: ins, error: insErr } = await supabaseServer
      .from("orders")
      .insert([{
        client_id,
        credits: credits || 0,
        amount_cents: amountCents,
        paystack_reference: reference,
        status: "pending",
        webhook_processed: false,
        created_at: new Date().toISOString()
      }])
      .select()
      .limit(1);

    if (insErr) {
      console.error("Order insert failed:", insErr);
      return res.status(500).json({ error: "db_insert_failed", detail: String(insErr.message || insErr) });
    }
  } catch (e) {
    console.error("Order insert exception:", e);
    return res.status(500).json({ error: "db_insert_exception", detail: String(e) });
  }

  // 2) Build Paystack payload for mobile money charge
  const payload = {
    email: email || `no-email-${client_id}@dollarchain.store`,
    amount: amountCents,
    currency: DEFAULT_CURRENCY,
    mobile_money: {
      phone: normalized,
      provider: "mpesa"
    },
    reference
  };

  // Helpful debug log (visible in Vercel logs)
  console.log("Starting MPESA charge — payload:", JSON.stringify(payload));

  // 3) Call Paystack Charge API
  try {
    const resp = await fetch("https://api.paystack.co/charge", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    const json = await resp.json();

    // Return Paystack's response (previous behavior preserved)
    if (!resp.ok) {
      console.warn("Paystack charge returned non-OK:", JSON.stringify(json));
      return res.status(502).json({ paystack: json, reference });
    }

    return res.status(200).json({ paystack: json, reference });
  } catch (err) {
    console.error("Paystack charge exception:", err);
    return res.status(500).json({ error: "paystack_charge_exception", detail: String(err) });
  }
}
