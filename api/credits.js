/**
 * GET /api/credits?client_id=...
 *
 * Security: server-side only. This endpoint uses SUPABASE_SERVICE_ROLE_KEY.
 * Keep that key secret in Vercel/ Replit secrets.
 *
 * Returns:
 * 200 { credits: number, blocked: boolean }
 * 400 missing param
 * 404 customer not found
 * 502 supabase error
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const client_id = req.query.client_id;
  if (!client_id) {
    return res.status(400).json({ error: "missing_client_id" });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing Supabase env keys");
    return res.status(500).json({ error: "server_misconfigured" });
  }

  try {
    const url = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/customers?client_id=eq.${encodeURIComponent(client_id)}&select=credits,blocked`;
    const r = await fetch(url, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Accept: "application/json"
      }
    });

    if (!r.ok) {
      const text = await r.text();
      console.error("Supabase /customers error:", r.status, text);
      return res.status(502).json({ error: "supabase_error", detail: text });
    }

    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(404).json({ error: "customer_not_found" });
    }

    const [customer] = rows;
    return res.status(200).json({
      credits: Number(customer.credits || 0),
      blocked: !!customer.blocked
    });
  } catch (err) {
    console.error("credits handler error:", err);
    return res.status(500).json({ error: "internal_error", message: String(err.message) });
  }
}
