import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Publishable (anon) key: safe to ship in the client bundle by design.
// All table access is locked behind SECURITY DEFINER RPCs, so this key can
// only call the sp_* functions, never read or write tables directly.
const URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://chkymwkafaljedtlrqoa.supabase.co";
const KEY =
  process.env.NEXT_PUBLIC_SUPABASE_KEY ?? "sb_publishable_oOhF3ge6yDhOEjn-JPrafg_8Ghf3B0q";

let cached: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!cached) {
    cached = createClient(URL, KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}
