import type { NextConfig } from "next";

// security/SECURITY.md's "Relevance to this app" note: this app had no HTTP
// security headers configured at all (same class as SEC-012/013/014/017/018/
// 076/085 in that register). script-src/style-src keep 'unsafe-inline'
// rather than a nonce - this app has no per-request nonce plumbing yet, and
// removing it outright would break Next's own hydration inline script plus
// this app's hand-written theme-init inline <script> in src/app/layout.tsx
// (dangerouslySetInnerHTML, no nonce). That's the same documented tradeoff
// SEC-078 flagged for style-src elsewhere - tightening to nonces is real
// follow-up work, not done here to avoid shipping a CSP that silently
// breaks dark-mode-on-first-paint or React hydration.
const isProd = process.env.NODE_ENV === "production";
const csp = [
  "default-src 'self'",
  // 'unsafe-eval' is Fast Refresh/HMR's requirement in `next dev` only -
  // dropped in production.
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  // next/font/google (used in layout.tsx) self-hosts font files at build
  // time and serves them from this app's own origin - no runtime request to
  // fonts.googleapis.com/fonts.gstatic.com, so font-src needs only 'self'.
  "font-src 'self'",
  // data: for small embedded/generated images (e.g. exported report
  // assets); this app doesn't otherwise load images from third-party hosts.
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // Belt-and-suspenders with frame-ancestors above, for older clients that
  // don't evaluate CSP frame-ancestors.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Every browser feature this app doesn't use, explicitly denied - not an
  // exhaustive Permissions-Policy allowlist, just the highest-value/most
  // commonly abused features.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  // Harmless to send over plain HTTP (browsers ignore it there) - only
  // takes effect once this app is actually served over HTTPS (e.g. behind
  // the Cloudflare tunnel from EXPOSE_TO_INTERNET.md, or a real deployment).
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  // security/ChatBot_VA_Report_Analysis.md's VA-012 class: Next.js sends
  // `X-Powered-By: Next.js` on every response by default, disclosing the
  // framework to anyone fingerprinting the stack. Off.
  poweredByHeader: false,
  // --- DEVELOPMENT-ONLY: remove/tighten before any production deploy ---
  // Next.js's dev server blocks cross-origin requests to dev-only assets
  // (HMR, /_next/*) by default, to stop a malicious site from reaching a
  // developer's local dev server. That protection is exactly what breaks
  // the app when accessed through a Cloudflare Quick Tunnel
  // (https://<random>.trycloudflare.com) or from another machine on the
  // LAN (http://<lan-ip>:3000) - the request arrives from a hostname
  // other than localhost, so Next rejects it (visible as "Blocked
  // cross-origin request to Next.js dev resource" in the browser console,
  // and as a malformed/"Unauthorized" response in cloudflared's own log
  // for the /_next/hmr WebSocket specifically).
  //
  // allowedDevOrigins has NO effect outside `next dev` - next build/start
  // don't run this check at all - but it's still scoped as narrowly as
  // "works for any tunnel/LAN host" allows, rather than "*":
  //   - *.trycloudflare.com: every Cloudflare Quick Tunnel hostname (a new
  //     random subdomain is assigned each time `npm run tunnel:cloudflare`
  //     runs - see EXPOSE_TO_INTERNET.md - so a wildcard is required, a
  //     single hostname would break on the next run)
  //   - the LAN IP ranges this machine's own adapters actually use (see
  //     EXPOSE_TO_INTERNET.md's "Same network" section), for the
  //     no-tunnel-needed same-network case
  allowedDevOrigins: [
    "*.trycloudflare.com",
    "192.168.56.*",
    "172.23.*.*",
    "192.168.137.*",
  ],
};

export default nextConfig;
