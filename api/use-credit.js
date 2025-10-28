/**
 * POST /api/use-credit
 * Body JSON: { client_id: string, amount: number, actor?: string, reason?: string }
 *
 * Response:
 * 200 { success: true, new_balance: number }
 * 400 missing/invalid
 * 402 insufficient_funds (returned as success:false)
 * 404 customer not found
 * 502 supabase error
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  let body = req.body;
  if (!body || Object.keys(body).length === 0) {
    // some clients send JSON as raw string; try parse
    try { body = JSON.parse(req.rawBody || "{}"); } catch (_) { /* ignore */ }
  }

  const client_id = body.client_id || (req.query && req.query.client_id);
  const amount = Number(body.amount);
  const actor = body.actor || body.user || "client";
  const reason = body.reason || "spend";

  if (!client_id) return res.status(400).json({ error: "missing_client_id" });
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) {
    return res.status(400).json({ error: "invalid_amount", message: "amount must be a positive integer" });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing Supabase env keys");
    return res.status(500).json({ error: "server_misconfigured" });
  }

  try {
    // 1) Call the RPC: POST /rest/v1/rpc/use_credits
    const rpcUrl = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/use_credits`;
    const rpcBody = {
      in_client_id: client_id,
      in_amount: amount,
      in_actor: actor,
      in_reason: reason
    };

    const rpcRes = await fetch(rpcUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify(rpcBody)
    });

    // If RPC responded with 4xx/5xx, surface error
    if (!rpcRes.ok) {
      const txt = await rpcRes.text();
      // If 400-ish, likely insufficient funds or customer not found (RPC raises exception)
      console.error("RPC use_credits failed:", rpcRes.status, txt);
      // Try to parse JSON error for clarity
      try {
        const j = JSON.parse(txt);
        return res.status(502).json({ error: "rpc_failed", detail: j });
      } catch {
        return res.status(502).json({ error: "rpc_failed", detail: txt });
      }
    }

    // RPC succeeded — now fetch updated customer balance
    const custUrl = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/customers?client_id=eq.${encodeURIComponent(client_id)}&select=credits`;
    const custRes = await fetch(custUrl, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Accept: "application/json"
      }
    });

    if (!custRes.ok) {
      const txt = await custRes.text();
      console.error("Supabase /customers after RPC error:", custRes.status, txt);
      return res.status(502).json({ error: "supabase_error_after_rpc", detail: txt });
    }

    const rows = await custRes.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(404).json({ error: "customer_not_found_after_rpc" });
    }

    const newBal = Number(rows[0].credits || 0);
    return res.status(200).json({ success: true, new_balance: newBal });
  } catch (err) {
    // If RPC returned a Postgres exception text, bubble it with some safety
    console.error("use-credit handler error:", err);
    return res.status(500).json({ error: "internal_error", message: String(err.message) });
  }
}
