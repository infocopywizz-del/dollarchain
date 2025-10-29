// api/create-paystack-payment.js
import { supabaseServer } from "../lib/supabaseServer.js";

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const BASE_URL = process.env.VITE_API_URL || "https://dollarchain.store";

function genReference() {
  return `dc-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  // support JSON body or raw string
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { /* ignore */ }
  }
  const { client_id, amount, email, credits } = body || {};

  if (!client_id || !email) {
    return res.status(400).json({ error: "invalid_payload", note: "client_id and email required" });
  }
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: "paystack_not_configured" });

  // amountCents = incoming amount (smallest currency unit), default to 10000 if missing
  const amountCents = Number.isFinite(Number(amount)) ? Number(amount) : 10000;

  const reference = genReference();

  // 1) Insert pending order (use amount_cents to match DB)
  try {
    const { data: orderData, error: insertErr } = await supabaseServer
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

    if (insertErr) {
      console.error("Order insert failed:", insertErr);
      return res.status(500).json({ error: "db_insert_failed", detail: String(insertErr.message || insertErr) });
    }
  } catch (e) {
    console.error("Order insert exception:", e);
    return res.status(500).json({ error: "db_insert_exception", detail: String(e) });
  }

  // 2) Initialize Paystack transaction (Paystack expects amount in smallest unit)
  try {
    const initRes = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        email,
        amount: amountCents,
        reference,
        callback_url: `${BASE_URL}/paystack-return`
      })
    });

    const initJson = await initRes.json();
    if (!initRes.ok || !initJson || !initJson.data) {
      console.error("Paystack initialize failed:", initJson);
      return res.status(502).json({ error: "paystack_init_failed", detail: initJson });
    }

    return res.status(200).json({
      authorization_url: initJson.data.authorization_url,
      reference: initJson.data.reference || reference
    });
  } catch (err) {
    console.error("Paystack initialize exception:", err);
    return res.status(500).json({ error: "paystack_exception", detail: String(err) });
  }
}
