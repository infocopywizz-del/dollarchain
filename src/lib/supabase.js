// Client-side Supabase helper.
// IMPORTANT: this file must only be used for non-sensitive, public reads.
// Server-side operations that mutate data must use the SUPABASE_SERVICE_ROLE_KEY
// from server environment variables (not exposed to clients).

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON);
