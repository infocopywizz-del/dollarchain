// api/start-mpesa-charge.js
import { supabaseServer } from "../lib/supabaseServer.js";

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const DEFAULT_CURRENCY = "KES"; // Kenya

function genReference() {
  return `dc-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const { client_id, amount, phone, credits, email } = body || {};

  if (!client_id || !phone || !Number.isFinite(Number(amount))) {
    return res.status(400).json({ error: "invalid_payload", note: "client_id, phone, amount (in smallest unit e.g., cents) required" });
  }
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: "paystack_not_configured" });

  const amountCents = Number(amount); // smallest unit (e.g., KES * 100)
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

  // 2) Call Paystack Charge API for mobile money (M-PESA)
  try {
    const payload = {
      email: email || `no-email-${client_id}@dollarchain.store`,
      amount: amountCents,
      currency: DEFAULT_CURRENCY,
      mobile_money: {
        phone: String(phone),
        provider: "mpesa"
      },
      reference
    };

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
    // Return Paystack's response (the UI can show display_text / data)
    return res.status(resp.ok ? 200 : 502).json({ paystack: json, reference });
  } catch (err) {
    console.error("Paystack charge exception:", err);
    return res.status(500).json({ error: "paystack_charge_exception", detail: String(err) });
  }
}
