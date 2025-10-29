// api/verify-paystack-payment.js
import { supabaseServer } from "../lib/supabaseServer.js";

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) {}
  }
  const { reference } = body || {};
  if (!reference) return res.status(400).json({ error: "missing_reference" });
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: "paystack_not_configured" });

  try {
    // find order
    const { data: ordersQ, error: qerr } = await supabaseServer.from("orders").select("*").eq("paystack_reference", reference).limit(1);
    if (qerr) {
      console.error("Orders query error:", qerr);
      return res.status(500).json({ error: "orders_query_failed", detail: String(qerr) });
    }
    const order = (ordersQ && ordersQ[0]) || null;
    if (!order) return res.status(404).json({ error: "order_not_found" });
    if (order.webhook_processed) return res.status(200).json({ ok: true, note: "already_processed" });

    // verify with Paystack
    const verifyResp = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}`, Accept: "application/json" },
    });
    const verifyJson = await verifyResp.json();

    if (!verifyResp.ok || !verifyJson || verifyJson?.data?.status !== "success") {
      return res.status(200).json({ ok: false, note: "not_successful", verify: verifyJson });
    }

    // mark order processed
    const { error: updErr } = await supabaseServer.from("orders").update({
      status: "success",
      webhook_processed: true,
      processed_at: new Date().toISOString()
    }).eq("id", order.id);
    if (updErr) console.error("Order update error:", updErr);

    // call add_credits rpc
    const { data: rpcData, error: rpcError } = await supabaseServer.rpc("add_credits", {
      in_client_id: order.client_id,
      in_amount: order.credits,
      in_actor: "paystack",
      in_reason: "payment"
    });

    if (rpcError) {
      console.error("add_credits rpc error:", rpcError);
      return res.status(500).json({ ok: false, error: "rpc_failed", detail: String(rpcError) });
    }

    // log payment event
    await supabaseServer.from("payment_events").insert([{ order_id: order.id, provider: "paystack", raw_payload: { verify: verifyJson } }]).catch(() => {});

    return res.status(200).json({ ok: true, credited: rpcData });
  } catch (err) {
    console.error("verify-paystack-payment error:", err);
    return res.status(500).json({ error: "unexpected_error", detail: String(err) });
  }
}
