/**
 * GET /api/credits?client_id=...
 *
 * Security: server-side only. This endpoint uses SUPABASE_SERVICE_ROLE_KEY.
 * Keep that key secret in Vercel/ Replit secrets.
 *
 * Returns: { credits: <number> } or 404 if not found.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const client_id = req.query.client_id;
  if (!client_id) return res.status(400).json({ error: "Missing client_id" });

  try {
    // Use Supabase REST to query customers (server-side with service role key)
    const url = `${SUPABASE_URL}/rest/v1/customers?client_id=eq.${encodeURIComponent(client_id)}&select=credits,phone,blocked`;
    const r = await fetch(url, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Accept: "application/json"
      }
    });

    if (!r.ok) {
      const txt = await r.text();
      console.error("Supabase error (credits):", r.status, txt);
      return res.status(502).json({ error: "Supabase error" });
    }

    const rows = await r.json();
    if (!rows.length) return res.status(404).json({ error: "customer not found" });

    const [customer] = rows;
    return res.status(200).json({ credits: Number(customer.credits || 0), blocked: !!customer.blocked });
  } catch (err) {
    console.error("credits handler error:", err);
    return res.status(500).json({ error: "internal_error" });
  }
}
