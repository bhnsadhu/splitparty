import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pure static export: `npm run build` emits ./out, which is what Capacitor
  // serves on-device. No server, no API routes; everything talks to Supabase.
  output: "export",
};

export default nextConfig;
