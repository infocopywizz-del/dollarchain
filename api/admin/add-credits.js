// api/admin/add-credits.js
import { supabaseServer } from "../../lib/supabaseServer.js";

const APP_MASTER_KEY = process.env.APP_MASTER_KEY;

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  // Ensure APP_MASTER_KEY is set in env
  if (!APP_MASTER_KEY) {
    console.error("APP_MASTER_KEY is not configured in environment.");
    return res.status(500).json({ error: "server_misconfigured", message: "missing APP_MASTER_KEY" });
  }

  // Accept header case-insensitively
  const master =
    req.headers["x-app-master-key"] ||
    req.headers["X-App-Master-Key"] ||
    req.headers["x-app-master-key".toLowerCase()];

  if (!master || master !== APP_MASTER_KEY) {
    return res.status(401).json({ error: "unauthorized" });
  }

  // Parse body safely
  let body = req.body || {};
  if (typeof body === "string" && body.length) {
    try {
      body = JSON.parse(body);
    } catch (e) {
      console.warn("Failed to parse JSON body:", e?.message || e);
      return res.status(400).json({ error: "invalid_json" });
    }
  }

  const client_id = body.client_id;
  const amount = Number(body.amount);
  const actor = body.actor || "admin";
  const reason = body.reason || "manual_topup";

  if (!client_id || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "invalid_payload", message: "client_id and positive integer amount required" });
  }

  try {
    // Use server-side Supabase client to call the add_credits RPC
    const { data, error } = await supabaseServer.rpc("add_credits", {
      in_client_id: client_id,
      in_amount: amount,
      in_actor: actor,
      in_reason: reason,
    });

    if (error) {
      console.error("RPC add_credits error:", error);
      return res.status(502).json({ error: "rpc_failed", detail: error.message || error });
    }

    // Normalize RPC result: supabase-js may return scalar, array, or object depending on config
    let newBalance = null;
    if (data === null || typeof data === "undefined") {
      // Unexpected but handle gracefully by fetching customer record
      const { data: rows, error: fetchErr } = await supabaseServer
        .from("customers")
        .select("credits")
        .eq("client_id", client_id)
        .limit(1);

      if (fetchErr) {
        console.error("Failed to fetch customer after RPC:", fetchErr);
        return res.status(502).json({ error: "fetch_after_rpc_failed", detail: fetchErr.message || fetchErr });
      }
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(404).json({ error: "customer_not_found_after_rpc" });
      }
      newBalance = Number(rows[0].credits || 0);
    } else if (Array.isArray(data)) {
      // rpc may return [balance] or [{balance:...}] depending on Postgres wrapper; try extract
      if (data.length === 0) newBalance = 0;
      else if (typeof data[0] === "object" && data[0] !== null && ("add_credits" in data[0] || "balance" in data[0])) {
        newBalance = Number(data[0].add_credits ?? data[0].balance ?? Object.values(data[0])[0]);
      } else {
        newBalance = Number(data[0]);
      }
    } else if (typeof data === "object") {
      // Could be { add_credits: 550 } or similar
      const vals = Object.values(data);
      newBalance = Number(vals[0]);
    } else {
      // scalar
      newBalance = Number(data);
    }

    if (!Number.isFinite(newBalance)) {
      // fallback: fetch customer record
      const { data: rows, error: fetchErr } = await supabaseServer
        .from("customers")
        .select("credits")
        .eq("client_id", client_id)
        .limit(1);

      if (fetchErr) {
        console.error("Failed to fetch customer as fallback:", fetchErr);
        return res.status(502).json({ error: "fetch_after_rpc_failed", detail: fetchErr.message || fetchErr });
      }
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(404).json({ error: "customer_not_found_after_rpc" });
      }
      newBalance = Number(rows[0].credits || 0);
    }

    return res.status(200).json({ success: true, new_balance: newBalance });
  } catch (err) {
    console.error("admin add-credits error:", err);
    return res.status(500).json({ error: "internal_error", message: String(err.message || err) });
  }
}
