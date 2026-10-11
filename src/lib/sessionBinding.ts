import { createHash } from "node:crypto";
import { clientIp, ipIsKnown } from "@/lib/rateLimit";

/**
 * Ties a session to the browser (and optionally the network) it was issued
 * to, so a copied session cookie doesn't simply work elsewhere
 * (docs/session-security.md).
 *
 *   SESSION_BIND_USER_AGENT   "true" (default) | "false"
 *       The session only works from the same browser (its User-Agent). A
 *       browser update changes it, which just means signing in again.
 *   SESSION_BIND_IP           "off" (default) | "subnet" | "exact"
 *       Also require the same network. Off by default: addresses change
 *       legitimately (mobile data, VPN, DHCP). Needs TRUST_PROXY=true behind
 *       a reverse proxy, or the address is unknown and the check is skipped.
 *
 * Neither is proof against a determined attacker (a User-Agent can be
 * copied), but both stop the common case and make theft visible.
 */

export interface ClientSeen {
  /** "" when not known (no trusted proxy header). */
  ip: string;
  userAgent: string;
}

type HeaderBag = { get(name: string): string | null };

export function clientSeen(headers: HeaderBag): ClientSeen {
  const ip = clientIp({ headers } as Request);
  return { ip: ipIsKnown(ip) ? ip : "", userAgent: (headers.get("user-agent") ?? "").slice(0, 400) };
}

/** Short, stable fingerprint of a User-Agent - what the cookie carries instead of the string. */
export function userAgentHash(userAgent: string): string {
  return createHash("sha256").update(userAgent).digest("hex").slice(0, 16);
}

export function bindUserAgent(): boolean {
  return (process.env.SESSION_BIND_USER_AGENT ?? "true").trim().toLowerCase() !== "false";
}

export function ipBindingMode(): "off" | "subnet" | "exact" {
  const mode = (process.env.SESSION_BIND_IP ?? "off").trim().toLowerCase();
  return mode === "subnet" || mode === "exact" ? mode : "off";
}

/** IPv4: the first three numbers (a /24). IPv6: the first four groups (a /64). */
function subnetOf(ip: string): string {
  if (ip.includes(":")) return ip.split(":").slice(0, 4).join(":");
  return ip.split(".").slice(0, 3).join(".");
}

/**
 * Why this request can't use the session it presents (null = it can).
 * Anything unknown on either side - an older cookie without the values, an
 * address the proxy doesn't pass on - is not treated as a mismatch.
 */
export function bindingProblem(session: { uaHash?: string; ip?: string }, now: ClientSeen): "browser" | "network" | null {
  if (bindUserAgent() && session.uaHash && now.userAgent && session.uaHash !== userAgentHash(now.userAgent)) return "browser";
  const mode = ipBindingMode();
  if (mode !== "off" && session.ip && now.ip) {
    const same = mode === "exact" ? session.ip === now.ip : subnetOf(session.ip) === subnetOf(now.ip);
    if (!same) return "network";
  }
  return null;
}

/** "Chrome on Windows" - for showing a sign-in to its owner. Deliberately coarse. */
export function describeUserAgent(userAgent: string): string {
  if (!userAgent) return "an unknown browser";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /OPR\/|Opera/.test(userAgent)
      ? "Opera"
      : /Firefox\//.test(userAgent)
        ? "Firefox"
        : /Chrome\//.test(userAgent)
          ? "Chrome"
          : /Safari\//.test(userAgent)
            ? "Safari"
            : "a browser";
  const os = /Windows/.test(userAgent)
    ? "Windows"
    : /Android/.test(userAgent)
      ? "Android"
      : /iPhone|iPad|iOS/.test(userAgent)
        ? "iOS"
        : /Mac OS X|Macintosh/.test(userAgent)
          ? "macOS"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "";
  return os ? `${browser} on ${os}` : browser;
}
