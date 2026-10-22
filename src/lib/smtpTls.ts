import type { ConnectionOptions } from "node:tls";
import { logger } from "@/lib/logger";

/**
 * TLS for the SMTP connection (docs/EMAIL_SETUP.md).
 *
 * Default: the mail server's certificate is fully checked (a trusted
 * authority, the right name).
 *
 * SMTP_ALLOW_SELF_SIGNED=true (env, optional): accept the mail server's
 * certificate WITHOUT checking it - for the bank's internal Exchange
 * (mail.nibbank.com.et), whose servers use a self-signed certificate and one
 * from the bank's own authority, neither naming mail.nibbank.com.et. The
 * connection is still encrypted (STARTTLS); the server just isn't verified,
 * so someone able to impersonate it on the network could read the SMTP
 * password. Internal mail servers only. No trust file, no certificate dates
 * to track.
 */
export function smtpAllowSelfSigned(): boolean {
  return (process.env.SMTP_ALLOW_SELF_SIGNED ?? "").trim().toLowerCase() === "true";
}

let warned = false;

export function smtpTlsOptions(): ConnectionOptions | undefined {
  if (!smtpAllowSelfSigned()) return undefined;
  if (!warned) {
    warned = true;
    logger.warn({ event: "email.tls_unverified" }, "SMTP_ALLOW_SELF_SIGNED=true: the mail server's certificate is not checked (connection still encrypted). Use it only for an internal mail server.");
  }
  return { rejectUnauthorized: false };
}
