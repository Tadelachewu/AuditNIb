import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => {
  const fn = () => vi.fn();
  return { toast: { success: fn(), error: fn(), warning: fn(), info: fn(), loading: fn(), dismiss: fn() } };
});

import { toast } from "sonner";
import { notify, notifications, presentError } from "@/lib/notify";
import { NOTIFY_DURATION } from "@/lib/notify/config";
import { ApiError } from "@/lib/api-client";

const t = vi.mocked(toast);
const lastCall = (m: ReturnType<typeof vi.fn>) => m.mock.calls.at(-1) as [string, { id: string; duration: number; description?: string }];
const apiErr = (status: number, code: string, message: string, extra: { details?: unknown; requestId?: string } = {}) =>
  new ApiError(message, status, { code, details: extra.details, requestId: extra.requestId ?? null });

beforeEach(() => Object.values(t).forEach((m) => (m as ReturnType<typeof vi.fn>).mockClear()));

describe("notification types", () => {
  it("each type uses its own toast kind, catalog text, code as id and the central duration", () => {
    notify.success(notifications.branch.deleted);
    expect(lastCall(t.success)).toEqual(["Branch deleted successfully.", { id: "BRANCH_DELETED", duration: NOTIFY_DURATION.success, description: undefined }]);
    notify.error(notifications.finding.saveFailed);
    expect(lastCall(t.error)[1]).toMatchObject({ id: "FINDING_SAVE_FAILED", duration: NOTIFY_DURATION.error });
    notify.warning(notifications.generic.fixFields);
    expect(lastCall(t.warning)[1].duration).toBe(NOTIFY_DURATION.warning);
    notify.info(notifications.auth.sessionExpired);
    expect(lastCall(t.info)[1].duration).toBe(NOTIFY_DURATION.info);
    const id = notify.loading("Saving finding...");
    expect(lastCall(t.loading)[1]).toMatchObject({ id, duration: Infinity });
  });

  it("durations are ordered by urgency", () => {
    expect(NOTIFY_DURATION.success).toBeLessThan(NOTIFY_DURATION.info);
    expect(NOTIFY_DURATION.info).toBeLessThan(NOTIFY_DURATION.warning);
    expect(NOTIFY_DURATION.warning).toBeLessThanOrEqual(NOTIFY_DURATION.error);
    expect(NOTIFY_DURATION.error).toBeGreaterThanOrEqual(8000); // readable, not a flash
  });
});

describe("duplicate prevention", () => {
  it("the same notification raised repeatedly reuses one id (updates in place)", () => {
    notify.fromError(apiErr(500, "INTERNAL_SERVER_ERROR", "x"), notifications.finding.saveFailed);
    notify.fromError(apiErr(500, "INTERNAL_SERVER_ERROR", "x"), notifications.finding.saveFailed);
    notify.fromError(apiErr(500, "INTERNAL_SERVER_ERROR", "x"), notifications.finding.saveFailed);
    const ids = t.error.mock.calls.map((c) => (c[1] as { id: string }).id);
    expect(new Set(ids).size).toBe(1);
  });
});

describe("loading -> success / error lifecycle", () => {
  it("resolves into one success notification with the same id", async () => {
    const result = await notify.promise(Promise.resolve(42), { loading: "Saving finding...", success: notifications.finding.updated, error: notifications.finding.saveFailed });
    expect(result).toBe(42);
    const loadingId = lastCall(t.loading)[1].id;
    expect(lastCall(t.success)).toEqual(["Finding updated successfully.", expect.objectContaining({ id: loadingId })]);
    expect(t.error).not.toHaveBeenCalled();
  });

  it("rejects into one error notification with the same id and re-throws", async () => {
    const failure = apiErr(503, "DATABASE_ERROR", "db down", { requestId: "abcdef12-3456" });
    await expect(
      notify.promise(Promise.reject(failure), { loading: "Saving finding...", success: notifications.finding.updated, error: notifications.finding.saveFailed })
    ).rejects.toBe(failure);
    const loadingId = lastCall(t.loading)[1].id;
    expect(lastCall(t.error)).toEqual(["Unable to save the finding. Please try again.", expect.objectContaining({ id: loadingId, description: "Reference: abcdef12" })]);
    expect(t.success).not.toHaveBeenCalled();
  });
});

describe("error code -> presentation mapping", () => {
  it("VALIDATION_ERROR with fields -> field presentation + one general warning", () => {
    const p = notify.fromError(apiErr(422, "VALIDATION_ERROR", "Name is required", { details: { fieldErrors: { name: ["Name is required"] } } }));
    expect(p).toEqual({ kind: "field", message: "Please correct the highlighted fields.", fieldErrors: { name: ["Name is required"] } });
    expect(t.warning).toHaveBeenCalledTimes(1);
    expect(t.error).not.toHaveBeenCalled();
  });

  it("business rule -> the server's safe rule message", () => {
    const p = notify.fromError(apiErr(409, "FINDING_NOT_READY_FOR_CLOSURE", "Awaiting district verification before this can be closed"), notifications.finding.saveFailed);
    expect(p.kind).toBe("business");
    expect(lastCall(t.error)[0]).toBe("Awaiting district verification before this can be closed");
  });

  it("authentication -> session-expired info (and sign-in)", () => {
    expect(presentError(apiErr(401, "AUTHENTICATION_FAILED", "x")).kind).toBe("auth");
  });

  it("authorization -> permission message", () => {
    notify.fromError(apiErr(403, "AUTHORIZATION_DENIED", "Forbidden"));
    expect(lastCall(t.error)[0]).toBe("You don't have permission to do that.");
  });

  it("not found -> 'no longer exists' warning", () => {
    expect(presentError(apiErr(404, "RESOURCE_NOT_FOUND", "")).message).toMatch(/no longer exists/);
  });

  it("unexpected / system errors use the action's failure text + reference, never the raw message", () => {
    notify.fromError(apiErr(500, "INTERNAL_SERVER_ERROR", "PrismaClientKnownRequestError: SELECT * FROM users", { requestId: "req_12345678-x" }), notifications.user.deleteFailed);
    const [msg, opts] = lastCall(t.error);
    expect(msg).toBe("Unable to delete the user. Please try again.");
    expect(opts.description).toBe("Reference: req_1234");
  });

  it("a non-API exception never shows its text", () => {
    notify.fromError(new Error("ECONNREFUSED 10.0.0.5:5432 at /srv/app/db.ts:12"));
    expect(lastCall(t.error)[0]).toBe("Something went wrong. Please try again.");
  });

  it("network failure -> connection message", () => {
    notify.fromError(apiErr(0, "NETWORK_ERROR", "x"));
    expect(lastCall(t.error)[0]).toMatch(/Can't reach the server/);
  });
});

describe("catalog consistency", () => {
  const all: { code: string; message: string }[] = [];
  const walk = (o: unknown) => {
    if (o && typeof o === "object" && "code" in o && "message" in o) all.push(o as { code: string; message: string });
    else if (o && typeof o === "object") Object.values(o).forEach(walk);
  };
  walk(notifications);

  it("codes are unique and UPPER_SNAKE_CASE", () => {
    expect(new Set(all.map((x) => x.code)).size).toBe(all.length);
    for (const x of all) expect(x.code).toMatch(/^[A-Z][A-Z0-9_]+$/);
  });

  it("messages are sentences, and never vague or technical", () => {
    for (const x of all) {
      expect(x.message).toMatch(/^[A-Z].*\.$/);
      expect(x.message).not.toMatch(/^(Success|Done|Completed|Operation successful)!?\.?$/i);
      expect(x.message).not.toMatch(/Prisma|SQL|ECONN|stack|Internal Server Error|\/api\//i);
    }
  });

  it("success messages follow '[Object] [action] successfully.'; failures 'Unable to ... Please try again.'", () => {
    for (const x of all) {
      if (/_(CREATED|UPDATED|DELETED|ACTIVATED|DEACTIVATED)$/.test(x.code)) expect(x.message).toMatch(/ successfully\.$/);
      if (/_FAILED$/.test(x.code)) expect(x.message).toMatch(/^Unable to .+\. Please try again\.$/);
    }
  });
});
