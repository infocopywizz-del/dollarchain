// api/paystack-webhook.js
// Robust Paystack webhook handler.
// - Verifies the transaction with Paystack Verify API (server-to-server).
// - Idempotent: skips orders already processed.
// - Calls add_credits RPC on success and logs payment_events.
// - Uses server-side Supabase client from lib/supabaseServer.js

import { supabaseServer } from "../lib/supabaseServer.js";

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  if (!PAYSTACK_SECRET) {
    console.error("Missing PAYSTACK_SECRET_KEY in environment.");
    return res.status(200).json({ ok: false, note: "missing_paystack_secret" });
  }

  // Ensure we have a body
  let body = req.body;
  if (!body) {
    try {
      const raw = await new Promise((resolve) => {
        let d = "";
        req.on && req.on("data", (c) => (d += c));
        req.on && req.on("end", () => resolve(d));
        setTimeout(() => resolve(""), 50);
      });
      body = raw ? JSON.parse(raw) : {};
    } catch (e) {
      console.warn("Could not parse raw webhook body:", e?.message ?? e);
      body = {};
    }
  }

  const reference = body?.data?.reference || body?.reference;
  const status = body?.data?.status || body?.status;

  // Log unknown payloads
  if (!reference) {
    console.warn("Webhook missing reference. Storing raw event for inspection.");
    await supabaseServer
      .from("payment_events")
      .insert([{ provider: "paystack", raw_payload: body }])
      .catch((e) => console.error("Failed to log unknown webhook event:", e));
    return res.status(200).json({ ok: true, note: "no_reference_logged" });
  }

  try {
    const { data: orders, error: qerr } = await supabaseServer
      .from("orders")
      .select("*")
      .eq("paystack_reference", reference)
      .limit(1);

    if (qerr) {
      console.error("Error querying orders table:", qerr);
      await supabaseServer
        .from("payment_events")
        .insert([{ provider: "paystack", raw_payload: body }])
        .catch(() => {});
      return res.status(200).json({ ok: false, note: "orders_query_error" });
    }

    const order = orders?.[0] || null;
    if (!order) {
      console.warn("Webhook received for unknown order:", reference);
      await supabaseServer
        .from("payment_events")
        .insert([{ provider: "paystack", raw_payload: body }])
        .catch(() => {});
      return res.status(200).json({ ok: true, note: "unknown_order_recorded" });
    }

    if (order.webhook_processed) {
      return res.status(200).json({ ok: true, note: "already_processed" });
    }

    // Verify transaction with Paystack
    const verifyResp = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET}`,
        Accept: "application/json",
      },
    });

    let verifyJson;
    try {
      verifyJson = await verifyResp.json();
    } catch (e) {
      console.error("Failed to parse Paystack verify response for", reference, e);
      verifyJson = null;
    }

    if (!verifyResp.ok || !verifyJson || verifyJson?.data?.status !== "success") {
      console.warn("Paystack verification failed or not successful for", reference, { ok: verifyResp.ok, verifyData: verifyJson });
      await supabaseServer
        .from("payment_events")
        .insert([{ order_id: order.id, provider: "paystack", raw_payload: { webhook: body, verify: verifyJson } }])
        .catch(() => {});
      return res.status(200).json({ ok: true, note: "not_successful" });
    }

    // Update order as processed
    await supabaseServer
      .from("orders")
      .update({ status: "success", webhook_processed: true, processed_at: new Date().toISOString() })
      .eq("id", order.id);

    // Call add_credits RPC
    const { data: rpcData, error: rpcError } = await supabaseServer.rpc("add_credits", {
      in_client_id: order.client_id,
      in_amount: order.credits,
      in_actor: "paystack",
      in_reason: "payment",
    });

    if (rpcError) {
      console.error("add_credits RPC error:", rpcError);
      await supabaseServer
        .from("payment_events")
        .insert([{ order_id: order.id, provider: "paystack", raw_payload: { webhook: body, verify: verifyJson, rpcError } }])
        .catch(() => {});
      return res.status(200).json({ ok: true, note: "credited_failed_but_event_logged" });
    }

    // Log successful payment
    await supabaseServer
      .from("payment_events")
      .insert([{ order_id: order.id, provider: "paystack", raw_payload: { webhook: body, verify: verifyJson } }])
      .catch((e) => console.warn("Failed to insert payment_event:", e));

    return res.status(200).json({ ok: true, credited: rpcData });
  } catch (err) {
    console.error("Unexpected webhook handler error:", err);
    await supabaseServer
      .from("payment_events")
      .insert([{ provider: "paystack", raw_payload: { error: String(err), webhook: body } }])
      .catch(() => {});
    return res.status(200).json({ ok: false, error: String(err) });
  }
}
