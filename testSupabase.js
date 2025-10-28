// testSupabase.js — simple and correct Supabase connectivity check
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_KEY in environment.");
  process.exit(1);
}

console.log("Using SUPABASE_URL:", SUPABASE_URL.startsWith("http"));
console.log("Using key length:", SUPABASE_KEY.length);

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function testConnection() {
  try {
    const { data, error, status } = await supabase
      .from("customers")
      .select("*")
      .limit(1);

    console.log("Query status:", status);
    if (error) {
      console.error("Query error (this is OK if table doesn't exist yet):", error.message);
    } else {
      console.log("Sample data:", data);
    }
  } catch (err) {
    console.error("Unexpected error:", err.message);
  }
}

testConnection();
