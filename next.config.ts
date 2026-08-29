import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
