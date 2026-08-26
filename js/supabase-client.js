// ============================================================
// SUPABASE CONFIG
// Browser-safe Supabase configuration. The publishable key is intentionally
// public; server-only keys must stay in Netlify environment variables.
// ============================================================
const SUPABASE_URL = "https://tawxmpsrxttwrsfjbklo.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_lcuRmIpsnfB-R1EcvyNwYw_nVJFjlK-";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
