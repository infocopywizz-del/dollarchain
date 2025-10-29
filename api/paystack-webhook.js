// api/paystack-webhook.js
// Defensive webhook: lazy-load Supabase client and return JSON errors so we can see what's failing.

let supabaseServer = null;

async function getSupabaseServer() {
  if (supabaseServer) return supabaseServer;
  try {
    // lazy import so missing env or import-time errors are caught inside handler
    const mod = await import("../lib/supabaseServer.js");
    supabaseServer = mod.supabaseServer;
    return supabaseServer;
  } catch (err) {
    // rethrow so caller can handle
    throw new Error(`Failed to load supabaseServer: ${err && err.message ? err.message : String(err)}`);
  }
}

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "method_not_allowed" });
    }

    if (!PAYSTACK_SECRET) {
      console.error("Missing PAYSTACK_SECRET_KEY in environment.");
      return res.status(500).json({ ok: false, note: "missing_paystack_secret" });
    }

    // parse body safely
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

    // attempt to lazy-load supabase client
    let sb;
    try {
      sb = await getSupabaseServer();
    } catch (err) {
      console.error("Supabase client load error:", err);
      // return JSON error (NOT HTML) so the frontend and curl can read it
      return res.status(500).json({ ok: false, error: "supabase_client_load_failed", detail: String(err.message || err) });
    }

    // now run the original logic (kept defensive)
    const reference = body?.data?.reference || body?.reference;
    if (!reference) {
      console.warn("Webhook missing reference. Storing raw event for inspection.");
      await sb.from("payment_events").insert([{ provider: "paystack", raw_payload: body }]).catch((e) => {
        console.error("Failed to log unknown webhook event:", e);
      });
      return res.status(200).json({ ok: true, note: "no_reference_logged" });
    }

    // find order
    const { data: orders, error: qerr } = await sb.from("orders").select("*").eq("paystack_reference", reference).limit(1);
    if (qerr) {
      console.error("Error querying orders table:", qerr);
      await sb.from("payment_events").insert([{ provider: "paystack", raw_payload: body }]).catch(() => {});
      return res.status(500).json({ ok: false, note: "orders_query_error", detail: String(qerr.message || qerr) });
    }

    const order = orders?.[0] || null;
    if (!order) {
      console.warn("Webhook received for unknown order:", reference);
      await sb.from("payment_events").insert([{ provider: "paystack", raw_payload: body }]).catch(() => {});
      return res.status(200).json({ ok: true, note: "unknown_order_recorded" });
    }

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
      await sb.from("payment_events").insert([{ order_id: order.id, provider: "paystack", raw_payload: { webhook: body, verify: verifyJson } }]).catch(() => {});
      return res.status(200).json({ ok: true, note: "not_successful" });
    }

    // mark order and credit
    await sb.from("orders").update({ status: "success", webhook_processed: true, processed_at: new Date().toISOString() }).eq("id", order.id);

    const { data: rpcData, error: rpcError } = await sb.rpc("add_credits", {
      in_client_id: order.client_id,
      in_amount: order.credits,
      in_actor: "paystack",
      in_reason: "payment",
    });

    if (rpcError) {
      console.error("add_credits RPC error:", rpcError);
      await sb.from("payment_events").insert([{ order_id: order.id, provider: "paystack", raw_payload: { webhook: body, verify: verifyJson, rpcError } }]).catch(() => {});
      return res.status(500).json({ ok: false, note: "rpc_failed", detail: String(rpcError.message || rpcError) });
    }

    await sb.from("payment_events").insert([{ order_id: order.id, provider: "paystack", raw_payload: { webhook: body, verify: verifyJson } }]).catch((e) => {
      console.warn("Failed to insert payment_event:", e);
    });

    return res.status(200).json({ ok: true, credited: rpcData });
  } catch (err) {
    // This catch ensures an error never returns HTML; we always reply with JSON
    console.error("Unexpected webhook handler error:", err);
    return res.status(500).json({ ok: false, error: "unexpected_handler_error", detail: String(err && err.stack ? err.stack : err) });
  }
}
