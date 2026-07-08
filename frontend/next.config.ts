import type { NextConfig } from "next";

const BACKEND = process.env.SECURITYOS_BACKEND_URL ?? "http://127.0.0.1:4000";

/**
 * The browser only ever talks to the Next.js server; API and media requests
 * are proxied to the local backend. Nothing is exposed beyond localhost.
 */
const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${BACKEND}/api/:path*` },
      { source: "/media/:path*", destination: `${BACKEND}/media/:path*` },
    ];
  },
};

export default nextConfig;
