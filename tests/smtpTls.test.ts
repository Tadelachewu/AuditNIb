import { afterEach, describe, expect, it } from "vitest";
import { smtpTlsOptions } from "@/lib/smtpTls";

// SMTP_ALLOW_SELF_SIGNED=true: the mail server's certificate isn't checked
// (the bank's internal Exchange); unset or anything else: the normal check.

afterEach(() => delete process.env.SMTP_ALLOW_SELF_SIGNED);

describe("SMTP_ALLOW_SELF_SIGNED", () => {
  it("unset or not 'true': the normal certificate check (no override)", () => {
    expect(smtpTlsOptions()).toBeUndefined();
    process.env.SMTP_ALLOW_SELF_SIGNED = "false";
    expect(smtpTlsOptions()).toBeUndefined();
    process.env.SMTP_ALLOW_SELF_SIGNED = "yes";
    expect(smtpTlsOptions()).toBeUndefined();
  });
  it("true: the certificate is accepted without checking it", () => {
    process.env.SMTP_ALLOW_SELF_SIGNED = " TRUE ";
    expect(smtpTlsOptions()).toEqual({ rejectUnauthorized: false });
  });
});
