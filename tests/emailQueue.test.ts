import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prismaClient", () => ({ prisma: {} }));

import { BACKOFF_MS, backoffMs, classifyError, emailConfigProblem, emailForNotification, renderNotificationEmail, rowUpdateFor, type RowUpdate } from "@/lib/emailQueue/rules";
import { handleJob, reconcileOnce, relayOnce, type JobQueue } from "@/lib/emailQueue/bullmq";
import { deliverDue, prepareQueuedEmails, processOutbox, resetEmailWorkerState } from "@/lib/emailQueue/service";
import type { EmailQueueStore } from "@/lib/emailQueue/store";
import type { EmailTransport } from "@/lib/emailQueue/transport";
import type { EmailQueueState, OutboxRow, QueuedEmail, SendOutcome } from "@/lib/emailQueue/types";
import { notifyUsers } from "@/lib/notifications";
import type { Database, Notification, NotificationSettings } from "@/types";

// Email queue - docs/email-queue.md.

const NOW = new Date("2026-10-10T08:00:00Z").getTime();
const smtp: NotificationSettings = { provider: "SMTP", fromAddress: "audit@nib.test", smtpHost: "mail.nib.test", smtpPort: 587 };
const env = { SMTP_USER: "u", SMTP_PASSWORD: "p", APP_BASE_URL: "https://audit.nib.test/" };

const notification = (over: Partial<Notification> = {}): Notification => ({
  id: "n1",
  recipientUserId: "u1",
  type: "RETURNED",
  title: "F-1 returned by district",
  message: "Fix <b>this</b> & resubmit",
  entityType: "Finding",
  entityId: "f1",
  readAt: null,
  createdAt: "2026-10-10T08:00:00Z",
  ...over,
});

function makeDb(settings: NotificationSettings = smtp): Database {
  return {
    notifications: [],
    users: [
      { id: "u1", email: "one@nib.test", status: "ACTIVE", role: "BRANCH_CONTROLLER" },
      { id: "u2", email: "", status: "ACTIVE", role: "BRANCH_MANAGER" },
      { id: "u3", email: "three@nib.test", status: "INACTIVE", role: "BRANCH_MANAGER" },
    ],
    settings: { notification: settings },
  } as unknown as Database;
}

describe("what gets queued", () => {
  it("queues one email per notified user who has an address - rendered, linked and HTML-escaped", () => {
    const email = emailForNotification(makeDb(), "u1", notification(), env, NOW)!;
    expect(email).toMatchObject({ toAddress: "one@nib.test", fromAddress: "audit@nib.test", subject: "F-1 returned by district", dedupeKey: "notification:n1", maxAttempts: 6 });
    expect(email.bodyText).toContain("Open in NIB Control360: https://audit.nib.test/findings/f1");
    expect(email.bodyHtml).toContain("Fix &lt;b&gt;this&lt;/b&gt; &amp; resubmit");
    expect(email.bodyHtml).not.toContain("<b>");
    expect(new Date(email.expiresAt).getTime()).toBe(NOW + 72 * 3_600_000);
  });

  it("queues nothing when the event is off, there is no address, or email isn't configured", () => {
    expect(emailForNotification(makeDb({ ...smtp, emailEvents: { RETURNED: false } }), "u1", notification(), env)).toBeNull();
    expect(emailForNotification(makeDb(), "u2", notification(), env)).toBeNull();
    expect(emailForNotification(makeDb({ ...smtp, provider: "NONE" }), "u1", notification(), env)).toBeNull();
    expect(emailForNotification(makeDb(), "u1", notification(), {})).toBeNull();
    expect(emailConfigProblem(smtp, {})).toMatch(/SMTP_USER/);
    expect(emailConfigProblem(smtp, env)).toBeNull();
  });

  it("support mail goes first; a subject never carries a line break", () => {
    expect(emailForNotification(makeDb(), "u1", notification({ type: "SUPPORT_REPLY" }), env)!.priority).toBeGreaterThan(0);
    expect(renderNotificationEmail(notification({ title: "a\r\nBcc: x@y" }), undefined).subject).toBe("a Bcc: x@y");
  });

  it("notifyUsers puts the email on the transaction's data instead of sending it", () => {
    vi.stubEnv("SMTP_USER", "u");
    vi.stubEnv("SMTP_PASSWORD", "p");
    const db = makeDb();
    notifyUsers(db, ["u1", "u2", "u3"], { type: "RETURNED", title: "t", message: "m", entityType: "Finding", entityId: "f1" });
    expect(db.notifications).toHaveLength(2); // u3 is inactive
    expect(db.pendingEmails).toHaveLength(1); // u2 has no address
    expect(db.pendingEmails![0]).toMatchObject({ toAddress: "one@nib.test", notificationId: db.notifications.find((n) => n.recipientUserId === "u1")!.id });
    vi.unstubAllEnvs();
  });
});

describe("retry rules", () => {
  it("backs off 1 min -> 5 min -> 15 min -> 1 h -> 4 h, with jitter", () => {
    expect([1, 2, 3, 4, 5].map((n) => backoffMs(n, () => 0.5))).toEqual(BACKOFF_MS.slice(0, 5));
    expect(backoffMs(1, () => 0)).toBe(48_000);
    expect(backoffMs(1, () => 1)).toBe(72_000);
  });

  it("classifies SMTP errors: retry, give up, or our configuration", () => {
    expect(classifyError({ code: "ETIMEDOUT" }).kind).toBe("transient");
    expect(classifyError({ responseCode: 451 }).kind).toBe("transient");
    expect(classifyError({ responseCode: 550 }).kind).toBe("permanent");
    expect(classifyError({ code: "EENVELOPE" }).kind).toBe("permanent");
    expect(classifyError({ code: "EAUTH", responseCode: 535 }).kind).toBe("config");
    // Stored text never carries the raw message (it can name hosts).
    expect(classifyError({ code: "ECONNECTION", message: "connect to mail.internal.bank:587" }).error).not.toContain("mail.internal");
  });

  it("retries a transient failure until the attempts run out, then fails", () => {
    const transient: SendOutcome = { kind: "transient", error: "Temporary failure (ETIMEDOUT)" };
    expect(rowUpdateFor({ attempts: 1, maxAttempts: 6 }, transient, NOW, () => 0.5)).toEqual({ status: "PENDING", nextAttemptAt: NOW + 60_000, error: transient.error, refundAttempt: false });
    expect(rowUpdateFor({ attempts: 6, maxAttempts: 6 }, transient, NOW).status).toBe("FAILED");
    expect(rowUpdateFor({ attempts: 1, maxAttempts: 6 }, { kind: "permanent", error: "x" }, NOW).status).toBe("FAILED");
    expect(rowUpdateFor({ attempts: 1, maxAttempts: 6 }, { kind: "config", error: "x" }, NOW)).toMatchObject({ status: "PENDING", refundAttempt: true });
    expect(rowUpdateFor({ attempts: 3, maxAttempts: 6 }, { kind: "sent", messageId: "<m>" }, NOW)).toEqual({ status: "SENT", messageId: "<m>" });
  });
});

// ---------------------------------------------------------------------------
// The worker, against an in-memory store and a scripted mail server

type Row = OutboxRow & { status: string; nextAttemptAt: number; lastError?: string | null; priority?: number; queuedAt?: number };

function fakeStore(rows: Row[], state: Partial<EmailQueueState> = {}) {
  const queueState: EmailQueueState = { paused: false, pausedReason: null, pausedAt: null, pausedBy: null, lastRunAt: null, lastRunBy: null, ...state };
  const updates: [string, RowUpdate][] = [];
  const store: EmailQueueStore = {
    isInstalled: async () => true,
    insert: vi.fn(async () => {}),
    recover: vi.fn(async () => {}),
    claim: async (_worker, limit) => {
      const due = rows
        .filter((r) => r.status === "PENDING" && r.nextAttemptAt <= NOW)
        .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
        .slice(0, limit);
      for (const r of due) {
        r.status = "SENDING";
        r.attempts += 1;
      }
      return due.map((r) => ({ ...r }));
    },
    apply: async (id, update) => {
      updates.push([id, update]);
      const row = rows.find((r) => r.id === id)!;
      row.status = update.status;
      if (update.status === "PENDING") {
        row.nextAttemptAt = update.nextAttemptAt;
        row.lastError = update.error;
        if (update.refundAttempt) row.attempts -= 1;
      }
    },
    handOff: async (_worker, limit) => {
      const due = rows
        .filter((r) => r.status === "PENDING" && r.nextAttemptAt <= NOW)
        .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
        .slice(0, limit);
      for (const r of due) {
        r.status = "QUEUED";
        r.queuedAt = NOW;
      }
      return due.map((r) => ({ id: r.id, priority: r.priority ?? 0 }));
    },
    claimQueued: async (id) => {
      const r = rows.find((x) => x.id === id && x.status === "QUEUED");
      if (!r) return null;
      r.status = "SENDING";
      r.attempts += 1;
      return { ...r };
    },
    releaseQueued: async (ids, reason, nextAttemptAt) => {
      for (const r of rows) {
        if (!ids.includes(r.id) || r.status !== "QUEUED") continue;
        r.status = "PENDING";
        r.lastError = reason;
        if (nextAttemptAt) r.nextAttemptAt = nextAttemptAt;
      }
    },
    staleQueued: async (before, limit) => rows.filter((r) => r.status === "QUEUED" && (r.queuedAt ?? 0) < before).slice(0, limit).map((r) => r.id),
    touchQueued: async (ids) => {
      for (const r of rows) if (ids.includes(r.id)) r.queuedAt = NOW;
    },
    getState: async () => queueState,
    setPaused: async (paused, reason, by) => Object.assign(queueState, { paused, pausedReason: reason, pausedBy: by }),
    recordRun: async (by) => void Object.assign(queueState, { lastRunBy: by }),
    cleanup: async () => {},
  };
  return { store, updates, queueState };
}

const row = (id: string, over: Partial<Row> = {}): Row => ({
  id,
  notificationType: "RETURNED",
  toAddress: `${id}@nib.test`,
  fromAddress: "audit@nib.test",
  subject: "s",
  bodyText: "t",
  bodyHtml: "<p>t</p>",
  attempts: 0,
  maxAttempts: 6,
  expiresAt: new Date(NOW + 3_600_000).toISOString(),
  status: "PENDING",
  nextAttemptAt: NOW,
  ...over,
});

const transportOf = (reply: (r: OutboxRow) => SendOutcome): EmailTransport & { sent: string[] } => {
  const sent: string[] = [];
  return {
    sent,
    send: async (r) => {
      const outcome = reply(r);
      if (outcome.kind === "sent") sent.push(r.id);
      return outcome;
    },
  };
};

const run = (store: EmailQueueStore, transport: EmailTransport, settings: NotificationSettings | undefined = smtp) =>
  processOutbox({ by: "test", deps: { store, transport, loadSettings: async () => settings, now: () => NOW, random: () => 0.5 } });

describe("the worker", () => {
  beforeEach(() => {
    resetEmailWorkerState();
    vi.stubEnv("SMTP_USER", "u");
    vi.stubEnv("SMTP_PASSWORD", "p");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("sends what is due, highest priority first, and records the run", async () => {
    const rows = [row("a"), row("b", { priority: 5 }), row("later", { nextAttemptAt: NOW + 60_000 })];
    const { store, queueState } = fakeStore(rows);
    const transport = transportOf(() => ({ kind: "sent", messageId: "<m>" }));
    expect(await run(store, transport)).toMatchObject({ claimed: 2, sent: 2, retried: 0, failed: 0 });
    expect(transport.sent).toEqual(["b", "a"]);
    expect(rows.map((r) => r.status)).toEqual(["SENT", "SENT", "PENDING"]);
    expect(queueState.lastRunBy).toBe("test");
  });

  it("a temporary failure is rescheduled; the same pass doesn't retry it", async () => {
    const rows = [row("a")];
    const { store } = fakeStore(rows);
    const transport = transportOf(() => ({ kind: "transient", error: "Temporary failure (ETIMEDOUT)" }));
    expect(await run(store, transport)).toMatchObject({ claimed: 1, sent: 0, retried: 1 });
    expect(rows[0]).toMatchObject({ status: "PENDING", attempts: 1, nextAttemptAt: NOW + 60_000 });
  });

  it("gives up after the last attempt, and at once on a permanent rejection", async () => {
    const rows = [row("last", { attempts: 5 }), row("bad")];
    const { store } = fakeStore(rows);
    const transport = transportOf((r) => (r.id === "bad" ? { kind: "permanent", error: "Rejected by the mail server (550)" } : { kind: "transient", error: "Temporary failure (421)" }));
    expect(await run(store, transport)).toMatchObject({ failed: 2 });
    expect(rows.map((r) => r.status)).toEqual(["FAILED", "FAILED"]);
  });

  it("an expired email is cancelled, never sent late", async () => {
    const rows = [row("old", { expiresAt: new Date(NOW - 1).toISOString() })];
    const { store } = fakeStore(rows);
    const transport = transportOf(() => ({ kind: "sent", messageId: null }));
    await run(store, transport);
    expect(rows[0].status).toBe("CANCELLED");
    expect(transport.sent).toEqual([]);
  });

  it("wrong credentials pause the whole queue without using up attempts", async () => {
    const rows = [row("a"), row("b")];
    const { store, queueState } = fakeStore(rows);
    await run(store, transportOf(() => ({ kind: "config", error: "The mail server refused the sign-in (EAUTH 535)" })));
    expect(queueState).toMatchObject({ paused: true, pausedBy: "system" });
    expect(rows.map((r) => [r.status, r.attempts])).toEqual([["PENDING", 0], ["PENDING", 0]]);
    // Paused: nothing is claimed until an admin resumes.
    expect(await run(store, transportOf(() => ({ kind: "sent", messageId: null })))).toMatchObject({ skipped: "paused", claimed: 0 });
  });

  it("a mail server that keeps failing opens the circuit breaker", async () => {
    const rows = Array.from({ length: 6 }, (_, i) => row(`r${i}`));
    const { store } = fakeStore(rows);
    const down = transportOf(() => ({ kind: "transient", error: "Temporary failure (ECONNECTION)" }));
    expect(await run(store, down)).toMatchObject({ retried: 6 });
    rows.push(row("next"));
    expect(await run(store, down)).toMatchObject({ skipped: "breaker", claimed: 0 });
  });

  it("does nothing when email isn't configured or the tables are missing", async () => {
    const { store } = fakeStore([row("a")]);
    const transport = transportOf(() => ({ kind: "sent", messageId: null }));
    expect(await run(store, transport, { ...smtp, provider: "NONE" })).toMatchObject({ skipped: "not-configured" });
    expect(await run({ ...store, isInstalled: async () => false }, transport)).toMatchObject({ skipped: "not-installed" });
    expect(transport.sent).toEqual([]);
  });
});

describe("hand-off from updateDb", () => {
  const queued = [{ id: "n1" } as QueuedEmail];

  it("inserts inside the caller's transaction when the queue is installed", async () => {
    const { store } = fakeStore([]);
    const prepared = await prepareQueuedEmails(queued, store);
    await prepared.insert!("tx");
    expect(store.insert).toHaveBeenCalledWith(queued, "tx");
  });

  it("has nothing to insert when no email was queued", async () => {
    const { store } = fakeStore([]);
    expect((await prepareQueuedEmails([], store)).insert).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// BullMQ driver: the outbox schedules, BullMQ dispatches (a fake queue here -
// the real one is exercised against Redis by scripts, not in unit tests)

function fakeQueue(opts: { down?: boolean } = {}) {
  const jobs = new Map<string, number>();
  const queue: JobQueue = {
    addMany: async (list) => {
      if (opts.down) throw new Error("ECONNREFUSED");
      for (const j of list) if (!jobs.has(j.id)) jobs.set(j.id, j.priority);
    },
    existing: async (ids) => {
      if (opts.down) throw new Error("ECONNREFUSED");
      return new Set(ids.filter((id) => jobs.has(id)));
    },
    counts: async () => ({ waiting: jobs.size, active: 0, delayed: 0 }),
  };
  return { queue, jobs, opts };
}

describe("BullMQ driver", () => {
  const depsOf = (store: EmailQueueStore, transport: EmailTransport) => ({ store, transport, loadSettings: async () => smtp, now: () => NOW, random: () => 0.5, workerId: "w1" });

  beforeEach(() => {
    resetEmailWorkerState();
    vi.stubEnv("SMTP_USER", "u");
    vi.stubEnv("SMTP_PASSWORD", "p");
    vi.stubEnv("EMAIL_QUEUE_DRIVER", "bullmq");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("the relay hands due emails to the queue, one job per email, and never twice", async () => {
    const rows = [row("a"), row("b"), row("later", { nextAttemptAt: NOW + 60_000 })];
    const { store } = fakeStore(rows);
    const { queue, jobs } = fakeQueue();
    expect(await relayOnce({ store, queue, workerId: "w1" }, 20)).toEqual({ handedOff: 2, redisDown: false });
    expect([...jobs.keys()]).toEqual(["a", "b"]);
    expect(rows.map((r) => r.status)).toEqual(["QUEUED", "QUEUED", "PENDING"]);
    expect(await relayOnce({ store, queue, workerId: "w1" }, 20)).toEqual({ handedOff: 0, redisDown: false });
  });

  it("a job is one attempt: sent, or back to the outbox with its retry time", async () => {
    const rows = [row("ok"), row("flaky")];
    const { store } = fakeStore(rows);
    const { queue } = fakeQueue();
    await relayOnce({ store, queue, workerId: "w1" }, 20);
    const transport = transportOf((r) => (r.id === "ok" ? { kind: "sent", messageId: "<m>" } : { kind: "transient", error: "Temporary failure (421)" }));
    expect(await handleJob("ok", depsOf(store, transport))).toBe("sent");
    expect(await handleJob("flaky", depsOf(store, transport))).toBe("retry");
    expect(rows.map((r) => [r.status, r.attempts])).toEqual([["SENT", 1], ["PENDING", 1]]);
    expect(rows[1].nextAttemptAt).toBe(NOW + 60_000);
  });

  it("a duplicate or stale job does nothing (the email isn't QUEUED any more)", async () => {
    const rows = [row("a", { status: "SENT" })];
    const { store } = fakeStore(rows);
    const transport = transportOf(() => ({ kind: "sent", messageId: null }));
    expect(await handleJob("a", depsOf(store, transport))).toBe("skipped");
    expect(transport.sent).toEqual([]);
  });

  it("gives up after the last attempt; wrong credentials pause the queue", async () => {
    const rows = [row("last", { attempts: 5, status: "QUEUED" }), row("cfg", { status: "QUEUED" })];
    const { store, queueState } = fakeStore(rows);
    const transport = transportOf((r) => (r.id === "cfg" ? { kind: "config", error: "The mail server refused the sign-in (EAUTH 535)" } : { kind: "transient", error: "Temporary failure (421)" }));
    expect(await handleJob("last", depsOf(store, transport))).toBe("failed");
    expect(await handleJob("cfg", depsOf(store, transport))).toBe("paused");
    expect(rows.map((r) => [r.status, r.attempts])).toEqual([["FAILED", 6], ["PENDING", 0]]);
    expect(queueState.paused).toBe(true);
  });

  it("while paused a job leaves its email in the outbox, unsent", async () => {
    const rows = [row("a", { status: "QUEUED" })];
    const { store } = fakeStore(rows, { paused: true });
    const transport = transportOf(() => ({ kind: "sent", messageId: null }));
    expect(await handleJob("a", depsOf(store, transport))).toBe("paused");
    expect(rows[0]).toMatchObject({ status: "PENDING", attempts: 0 });
    expect(transport.sent).toEqual([]);
  });

  it("recovers emails whose job vanished from Redis", async () => {
    const rows = [row("lost", { status: "QUEUED", queuedAt: NOW - 10 * 60_000 }), row("alive", { status: "QUEUED", queuedAt: NOW - 10 * 60_000 }), row("fresh", { status: "QUEUED", queuedAt: NOW })];
    const { store } = fakeStore(rows);
    const { queue, jobs } = fakeQueue();
    jobs.set("alive", 0);
    expect(await reconcileOnce({ store, queue, now: () => NOW })).toBe(1);
    expect(rows.map((r) => r.status)).toEqual(["PENDING", "QUEUED", "QUEUED"]);
  });

  it("Redis down: nothing is stranded - the pass is delivered by the Postgres worker", async () => {
    const rows = [row("a"), row("b")];
    const { store } = fakeStore(rows);
    const transport = transportOf(() => ({ kind: "sent", messageId: null }));
    const result = await deliverDue({ by: "test", queue: fakeQueue({ down: true }).queue, deps: { store, transport, loadSettings: async () => smtp, now: () => NOW, random: () => 0.5 } });
    expect(result).toMatchObject({ redisFallback: true, sent: 2 });
    expect(rows.map((r) => r.status)).toEqual(["SENT", "SENT"]);
  });

  it("Redis up: the pass only hands off; BullMQ workers do the sending", async () => {
    const rows = [row("a"), row("b")];
    const { store } = fakeStore(rows);
    const transport = transportOf(() => ({ kind: "sent", messageId: null }));
    const { queue, jobs } = fakeQueue();
    const result = await deliverDue({ by: "test", queue, deps: { store, transport, loadSettings: async () => smtp, now: () => NOW, random: () => 0.5 } });
    expect(result).toMatchObject({ handedOff: 2, sent: 0 });
    expect(result.redisFallback).toBeUndefined();
    expect(jobs.size).toBe(2);
    expect(transport.sent).toEqual([]);
  });
});
