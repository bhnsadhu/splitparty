import type { NextConfig } from "next";

// Static export is the default so `npm run build` keeps emitting ./out for
// Capacitor. The Vercel web deploy opts out via `npm run build:web`, which is
// the only build that needs a server: /api/keepalive must run on a schedule to
// stop Supabase's free tier from auto-pausing after 7 idle days. A static
// export cannot host that route -- Vercel crons only invoke Vercel Functions,
// and a force-static route would bake its response at build time and never
// reach Postgres at all.
const staticExport = process.env.SP_WEB_BUILD !== "1";

const nextConfig: NextConfig = {
  // Pure static export: `npm run build` emits ./out, which is what Capacitor
  // serves on-device. No server, no API routes; everything talks to Supabase.
  output: staticExport ? "export" : undefined,
  // Only the web build treats `*.web.ts` as a route, which keeps
  // app/api/keepalive/route.web.ts out of the static export entirely. Without
  // this the Capacitor build fails: a dynamic route handler is illegal under
  // `output: "export"`, and making it static would defeat the keepalive.
  pageExtensions: staticExport
    ? ["tsx", "ts", "jsx", "js"]
    : ["web.ts", "tsx", "ts", "jsx", "js"],
  // Emit route directories (for example /privacy/index.html) so static hosts,
  // Capacitor, and copied share links can resolve routes without custom rewrites.
  trailingSlash: true,
  // Keep production client source out of the exported web bundle.
  productionBrowserSourceMaps: false,
};

export default nextConfig;
