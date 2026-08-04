const KNOWN_PRODUCTION_HOST = "chkymwkafaljedtlrqoa.supabase.co";
const PRODUCTION_OVERRIDE = "I_UNDERSTAND_THIS_MUTATES_PRODUCTION";

/** Resolve E2E credentials without ever falling back to a shipped project. */
export function e2eConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) {
    throw new Error(
      "Set SUPABASE_URL and SUPABASE_KEY for an isolated local/test Supabase project.",
    );
  }

  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("SUPABASE_URL must be a valid URL.");
  }

  const local = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (!local && process.env.SPLITPARTY_E2E_ALLOW_REMOTE !== "1") {
    throw new Error(
      "Refusing remote E2E mutations. Use a local project or explicitly set SPLITPARTY_E2E_ALLOW_REMOTE=1.",
    );
  }
  if (
    host === KNOWN_PRODUCTION_HOST &&
    process.env.SPLITPARTY_E2E_ALLOW_PRODUCTION !== PRODUCTION_OVERRIDE
  ) {
    throw new Error(
      `Refusing the production project. The additional override is SPLITPARTY_E2E_ALLOW_PRODUCTION=${PRODUCTION_OVERRIDE}.`,
    );
  }

  return { url, key };
}
