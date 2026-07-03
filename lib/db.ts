import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

// Fallbacks so a fresh Vercel deploy works before env vars are configured.
// This file is server-only; neither value is ever bundled for the browser.
// The key is Supabase's publishable (anon) key, not a service secret.
const FALLBACK_URL = "https://chkymwkafaljedtlrqoa.supabase.co";
const FALLBACK_KEY = "sb_publishable_oOhF3ge6yDhOEjn-JPrafg_8Ghf3B0q";

/** Server-only Supabase client. The key never reaches the browser. */
export function db(): SupabaseClient {
  if (!cached) {
    const url = process.env.SUPABASE_URL ?? FALLBACK_URL;
    const key = process.env.SUPABASE_KEY ?? FALLBACK_KEY;
    cached = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}
