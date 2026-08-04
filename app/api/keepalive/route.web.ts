import { supabase } from "@/lib/supabase";

// Supabase pauses free-tier projects after 7 days without real database
// activity. Web traffic alone does not count -- a query has to reach Postgres.
// A paused database is what broke the App Store review build, so this route
// exists purely to run one genuine read on a schedule (see vercel.json crons,
// plus the independent GitHub Actions workflow that hits Supabase directly).
//
// Never prerender: a build-time response would be a static file that keeps
// returning success while the database quietly goes idle.
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Matches sp_check_device's ^[A-Za-z0-9-]{10,64}$ but cannot collide with a
// real device UUID, so sp_my_events always returns [] and reads nothing real.
const PROBE_DEVICE_ID = "keepalive-probe-do-not-use";

// A no-input read-only endpoint has little to abuse beyond invocation cost, so
// cap how often anonymous traffic can reach Postgres. Best-effort and
// per-instance (Fluid Compute reuses instances); it is a damper, not a quota.
const THROTTLE_MS = 60_000;
let lastProbeAt = 0;
let lastProbeMs = 0;

/**
 * Runs the keepalive read. Returns how long the round trip took so the caller
 * can tell a real Postgres query from a cached or short-circuited response.
 */
async function probeDatabase(): Promise<number> {
  const startedAt = Date.now();
  const { error } = await supabase().rpc("sp_my_events", {
    p_device_id: PROBE_DEVICE_ID,
  });
  if (error) {
    throw new Error(`${error.code ?? "unknown"}: ${error.message}`);
  }
  return Date.now() - startedAt;
}

export async function GET(request: Request): Promise<Response> {
  // Vercel tags cron invocations with this user agent. Scheduled runs must
  // never be served from the throttle -- skipping their query would defeat the
  // entire point of the route.
  const isCron = request.headers.get("user-agent") === "vercel-cron/1.0";
  const schedule = request.headers.get("x-vercel-cron-schedule");
  const now = Date.now();

  if (!isCron && now - lastProbeAt < THROTTLE_MS) {
    return Response.json(
      { ok: true, queried: false, throttled: true, source: "supabase" },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const durationMs = await probeDatabase();
    lastProbeAt = now;
    lastProbeMs = durationMs;
    return Response.json(
      {
        ok: true,
        queried: true,
        throttled: false,
        source: "supabase",
        durationMs,
        cron: isCron,
        ...(schedule ? { schedule } : {}),
        at: new Date(now).toISOString(),
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    // Surface failures loudly: a silently failing keepalive is the exact
    // condition this route exists to prevent.
    return Response.json(
      {
        ok: false,
        queried: false,
        source: "supabase",
        lastSuccessfulProbeMs: lastProbeMs || undefined,
        error: error instanceof Error ? error.message : "keepalive failed",
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
