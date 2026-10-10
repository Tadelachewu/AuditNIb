import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/system/auto-transfer - the endpoint a scheduler (cron, Windows
// Task Scheduler...) calls. Protected by AUTO_TRANSFER_CRON_SECRET.

vi.mock("@/lib/autoTransfer", () => ({ runAutoTransferIfDue: vi.fn(async () => ({ ran: true, runs: [] })) }));
// The same call also runs the daily rectification reminders (src/lib/reminders).
vi.mock("@/lib/reminders", () => ({
  runRemindersIfDue: vi.fn(async () => ({ ran: true, run: { remindedFindings: 3, notifiedUsers: 2 } })),
  getReminderStatus: vi.fn(),
}));
const limiter = { count: 0 };
vi.mock("@/lib/rateLimit", () => ({
  clientIp: () => "10.0.0.5",
  isRateLimited: vi.fn(async () => ({ limited: limiter.count >= 10, retryAfterSeconds: 900 })),
  recordAttempt: vi.fn(async () => {
    limiter.count++;
  }),
}));
vi.mock("@/lib/monitoring", () => ({ captureServerException: vi.fn(async () => {}) }));

import { runAutoTransferIfDue } from "@/lib/autoTransfer";
import { runRemindersIfDue } from "@/lib/reminders";
import { POST } from "@/app/api/system/auto-transfer/route";

const SECRET = "a-long-random-secret-1234567890";
const call = (secret?: string) =>
  POST(new Request("http://localhost/api/system/auto-transfer", { method: "POST", headers: secret ? { "x-auto-transfer-secret": secret } : {} }), {} as never);

beforeEach(() => {
  limiter.count = 0;
  vi.mocked(runAutoTransferIfDue).mockClear();
  vi.mocked(runRemindersIfDue).mockClear();
  process.env.AUTO_TRANSFER_CRON_SECRET = SECRET;
});
afterEach(() => {
  delete process.env.AUTO_TRANSFER_CRON_SECRET;
});

describe("scheduler endpoint", () => {
  it("is switched off (404) while no secret is configured", async () => {
    delete process.env.AUTO_TRANSFER_CRON_SECRET;
    expect((await call(SECRET)).status).toBe(404);
  });

  it("refuses a missing or wrong secret (403) and doesn't run", async () => {
    expect((await call()).status).toBe(403);
    expect((await call("wrong-secret-wrong-secret")).status).toBe(403);
    expect(runAutoTransferIfDue).not.toHaveBeenCalled();
    expect(runRemindersIfDue).not.toHaveBeenCalled();
  });

  it("runs every scheduled job with the right secret: the transfer (forced) and the reminders", async () => {
    const res = await call(SECRET);
    expect(res.status).toBe(200);
    // The transfer's own fields stay at the top level (older scheduler scripts read them).
    expect(await res.json()).toEqual({ ran: true, runs: [], reminders: { ran: true, skipped: null, findings: 3, users: 2 } });
    expect(runAutoTransferIfDue).toHaveBeenCalledWith({ force: true, trigger: "scheduler" });
    expect(runRemindersIfDue).toHaveBeenCalledWith({ trigger: "scheduler" });
  });

  it("blocks an address after 10 wrong secrets (429), even with the right one", async () => {
    for (let i = 0; i < 10; i++) await call("wrong-secret-wrong-secret");
    expect((await call(SECRET)).status).toBe(429);
  });
});
