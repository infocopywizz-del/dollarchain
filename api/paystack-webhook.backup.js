// api/paystack-webhook.js
// Defensive webhook: lazy-load Supabase client and handle DB calls with try/await (no direct .catch chains)

import crypto from "crypto";

let supabaseServer = null;

async function getSupabaseServer() {
  if (supabaseServer) return supabaseServer;
  try {
    const mod = await import("../lib/supabaseServer.js");
    supabaseServer = mod.supabaseServer;
    return supabaseServer;
  } catch (err) {
    throw new Error(`Failed to load supabaseServer: ${err && err.message ? err.message : String(err)}`);
  }
}

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;

/**
 * Verify Paystack webhook signature using HMAC SHA512
 */
function verifyPaystackSignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  const hash = crypto
    .createHmac("sha512", secret)
    .update(rawBody)
    .digest("hex");
  return hash === signature;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "method_not_allowed" });
    }

    if (!PAYSTACK_SECRET) {
      console.error("Missing PAYSTACK_SECRET_KEY in environment.");
      return res.status(500).json({ ok: false, note: "missing_paystack_secret" });
    }

    // Get raw body for signature verification
    let rawBody = "";
    let body = req.body;
    
    if (!body) {
      try {
        rawBody = await new Promise((resolve) => {
          let d = "";
          req.on && req.on("data", (c) => (d += c));
          req.on && req.on("end", () => resolve(d));
          setTimeout(() => resolve(""), 50);
        });
        body = rawBody ? JSON.parse(rawBody) : {};
      } catch (e) {
        console.warn("Could not parse raw webhook body:", e?.message ?? e);
        body = {};
      }
    } else {
      // Body already parsed by express.json()
      rawBody = JSON.stringify(body);
    }

    // Verify webhook signature (SECURITY)
    const signature = req.headers["x-paystack-signature"];
    if (!verifyPaystackSignature(rawBody, signature, PAYSTACK_SECRET)) {
      console.warn("Invalid Paystack webhook signature. Possible spoofing attempt.");
      return res.status(401).json({ error: "invalid_signature" });
    }

    // lazy-load supabase client
    let sb;
    try {
      sb = await getSupabaseServer();
    } catch (err) {
      console.error("Supabase client load error:", err);
      return res.status(500).json({ ok: false, error: "supabase_client_load_failed", detail: String(err.message || err) });
    }

    const eventType = body?.event;
    const reference = body?.data?.reference || body?.reference;
    
    console.log(`[Webhook] Received event: ${eventType}, reference: ${reference || "NONE"}`);
    
    if (!reference) {
      console.warn("Webhook missing reference. Storing raw event for inspection.");
      console.warn("Event type:", eventType, "Body keys:", Object.keys(body || {}));
      try {
        const { data, error } = await sb.from("payment_events").insert([{ provider: "paystack", raw_payload: body }]);
        if (error) console.error("Failed to insert unknown webhook event:", error);
      } catch (e) {
        console.error("Exception inserting unknown webhook event:", e);
      }
      return res.status(200).json({ ok: true, note: "no_reference_logged" });
    }
    
    // Only process charge.success events for M-PESA
    if (eventType !== "charge.success") {
      console.log(`[Webhook] Ignoring non-charge.success event: ${eventType}`);
      return res.status(200).json({ ok: true, note: "event_ignored", event: eventType });
    }

    // find order
    let orders;
    try {
      const q = await sb.from("orders").select("*").eq("paystack_reference", reference).limit(1);
      // supabase-js v2 returns { data, error }
      if (q.error) {
        console.error("Error querying orders table:", q.error);
        try {
          const { data, error } = await sb.from("payment_events").insert([{ provider: "paystack", raw_payload: body }]);
          if (error) console.error("Failed to log orders_query_error event:", error);
        } catch (ie) {
          console.error("Exception logging orders_query_error:", ie);
        }
        return res.status(500).json({ ok: false, note: "orders_query_error", detail: String(q.error.message || q.error) });
      }
      orders = q.data;
    } catch (e) {
      console.error("Unexpected error querying orders:", e);
      try {
        await sb.from("payment_events").insert([{ provider: "paystack", raw_payload: body }]);
      } catch (_) {}
      return res.status(500).json({ ok: false, error: "orders_query_exception", detail: String(e) });
    }

    const order = orders?.[0] || null;
    if (!order) {
      console.warn(`[Webhook] No order found for reference: ${reference}`);
      console.warn(`[Webhook] This usually means:`);
      console.warn(`  1. The order wasn't created before the payment was initiated`);
      console.warn(`  2. The reference doesn't match what's in the database`);
      console.warn(`  3. There's a timing issue - payment completed before order was saved`);
      try {
        const { data, error } = await sb.from("payment_events").insert([{ provider: "paystack", raw_payload: body }]);
        if (error) console.error("Failed to insert unknown_order_recorded event:", error);
      } catch (e) {
        console.error("Exception inserting unknown_order_recorded event:", e);
      }
      return res.status(200).json({ ok: true, note: "unknown_order_recorded", reference });
    }
    
    console.log(`[Webhook] Found order ID: ${order.id}, client: ${order.client_id}, status: ${order.status}`);

    if (order.webhook_processed) {
      return res.status(200).json({ ok: true, note: "already_processed" });
    }

    // verify with Paystack
    const verifyResp = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}`, Accept: "application/json" },
    });

    let verifyJson = null;
    try { verifyJson = await verifyResp.json(); } catch (e) { console.error("Failed to parse verify response", e); }

    if (!verifyResp.ok || !verifyJson || verifyJson?.data?.status !== "success") {
      console.warn("Paystack verification failed:", { ok: verifyResp.ok, verifyJson });
      try {
        const { data, error } = await sb.from("payment_events").insert([{ order_id: order.id, provider: "paystack", raw_payload: { webhook: body, verify: verifyJson } }]);
        if (error) console.error("Failed to insert not_successful event:", error);
      } catch (e) {
        console.error("Exception inserting not_successful event:", e);
      }
      return res.status(200).json({ ok: true, note: "not_successful" });
    }

    // mark order processed
    try {
      const upd = await sb.from("orders").update({ status: "success", webhook_processed: true, processed_at: new Date().toISOString() }).eq("id", order.id);
      if (upd.error) console.error("Failed to update order as processed:", upd.error);
    } catch (e) {
      console.error("Exception updating order:", e);
    }

    // call add_credits RPC
    let rpcData;
    try {
      const rpcRes = await sb.rpc("add_credits", {
        in_client_id: order.client_id,
        in_amount: order.credits,
        in_actor: "paystack",
        in_reason: "payment",
      });
      if (rpcRes.error) {
        console.error("add_credits RPC error:", rpcRes.error);
        try {
          const { data, error } = await sb.from("payment_events").insert([{ order_id: order.id, provider: "paystack", raw_payload: { webhook: body, verify: verifyJson, rpcError: rpcRes.error } }]);
          if (error) console.error("Failed to insert rpc_error event:", error);
        } catch (e) {
          console.error("Exception inserting rpc_error event:", e);
        }
        return res.status(500).json({ ok: false, note: "rpc_failed", detail: String(rpcRes.error.message || rpcRes.error) });
      }
      rpcData = rpcRes.data;
    } catch (e) {
      console.error("Exception calling add_credits RPC:", e);
      try {
        const { data, error } = await sb.from("payment_events").insert([{ order_id: order.id, provider: "paystack", raw_payload: { webhook: body, verify: verifyJson, rpcException: String(e) } }]);
        if (error) console.error("Failed to log rpc exception:", error);
      } catch (_) {}
      return res.status(500).json({ ok: false, error: "rpc_exception", detail: String(e) });
    }

    // log successful payment event
    try {
      const { data, error } = await sb.from("payment_events").insert([{ order_id: order.id, provider: "paystack", raw_payload: { webhook: body, verify: verifyJson } }]);
      if (error) console.error("Failed to insert payment_event after rpc:", error);
    } catch (e) {
      console.warn("Failed to insert payment_event after rpc (exception):", e);
    }

    return res.status(200).json({ ok: true, credited: rpcData });
  } catch (err) {
    console.error("Unexpected webhook handler error:", err);
    return res.status(500).json({ ok: false, error: "unexpected_handler_error", detail: String(err && err.stack ? err.stack : err) });
  }
}
