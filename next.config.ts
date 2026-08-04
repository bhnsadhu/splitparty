import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pure static export: `npm run build` emits ./out, which is what Capacitor
  // serves on-device. No server, no API routes; everything talks to Supabase.
  output: "export",
  // Emit route directories (for example /privacy/index.html) so static hosts,
  // Capacitor, and copied share links can resolve routes without custom rewrites.
  trailingSlash: true,
  // Keep production client source out of the exported web bundle.
  productionBrowserSourceMaps: false,
};

export default nextConfig;
