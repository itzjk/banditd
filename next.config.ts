import type { NextConfig } from "next";

// No page of banditd is meant to be framed, so clickjacking is shut on every
// route: frame-ancestors for current browsers, X-Frame-Options for old ones.
// The policy leaves script-src alone on purpose: Next injects inline bootstrap
// scripts, and locking them down needs per-request nonces, not a header here.
export const SECURITY_HEADERS = [
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      {
        source: "/.well-known/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=300" }],
      },
    ];
  },
};

export default nextConfig;
