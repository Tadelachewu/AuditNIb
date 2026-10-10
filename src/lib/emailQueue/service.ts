import os from "node:os";
import { prisma } from "@/lib/prismaClient";
import { logger } from "@/lib/logger";
import type { NotificationSettings } from "@/types";
import { bullmqJobQueue, closeBullmq, reconcileOnce, relayOnce, resetBullmqBreaker, startBullmqWorker, type JobQueue } from "./bullmq";
import { BREAKER_PAUSE_MS, BREAKER_THRESHOLD, EXPIRY_MS, QUEUED_CHECK_AFTER_MS, emailConfigProblem, isExpired, rowUpdateFor } from "./rules";
import { cancelQueued, prismaEmailQueueStore, queueCounts, requeueFailed, type EmailQueueStore } from "./store";
import { smtpEmailTransport, type EmailTransport } from "./transport";
import type { EmailQueueDriver, EmailQueueStatus, ProcessResult, QueuedEmail } from "./types";

/**
 * The email queue's worker (docs/email-queue.md).
 *
 * Two drivers deliver what the outbox holds (EMAIL_QUEUE_DRIVER):
 *   postgres (default)   processOutbox() claims due rows and sends them itself.
 *   bullmq               deliverDue() hands due rows to BullMQ on Redis and a
 *                        BullMQ worker sends them (./bullmq.ts). If Redis is
 *                        down it falls back to processOutbox() for that pass.
 *
 *   deliverDue()         one pass with the configured driver - safe to call
 *                        from several places and several servers at once.
 *   kickEmailWorker()    "something was just queued": deliver now, don't wait.
 *   startEmailWorker()   the in-process loop (src/instrumentation.ts): retries
 *                        and anything a kick missed.
 *
 * It never throws into a caller: a mail problem must not break the request
 * that queued the email.
 */

export interface EmailQueueDeps {
  store: EmailQueueStore;
  transport: EmailTransport;
  /** Settings.notification, read fresh (never the whole Database). */
  loadSettings: () => Promise<NotificationSettings | undefined>;
  now: () => number;
  random: () => number;
}

async function loadNotificationSettings(): Promise<NotificationSettings | undefined> {
  const row = await prisma.settings.findUnique({ where: { id: "singleton" }, select: { notification: true } });
  return (row?.notification ?? undefined) as NotificationSettings | undefined;
}

const defaultDeps: EmailQueueDeps = {
  store: prismaEmailQueueStore,
  transport: smtpEmailTransport,
  loadSettings: loadNotificationSettings,
  now: Date.now,
  random: Math.random,
};

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
}

/** "postgres" (default): the built-in worker. "bullmq": BullMQ on Redis dispatches (needs REDIS_URL). */
export function queueDriver(): EmailQueueDriver {
  return process.env.EMAIL_QUEUE_DRIVER?.trim().toLowerCase() === "bullmq" ? "bullmq" : "postgres";
}

/** "inprocess" (default): this app delivers. "external": a separate `npm run worker:email` does. */
export function workerMode(): "inprocess" | "external" {
  return process.env.EMAIL_WORKER?.trim().toLowerCase() === "external" ? "external" : "inprocess";
}

const WORKER_ID = `${os.hostname()}:${process.pid}:${Math.random().toString(36).slice(2, 8)}`;
/** How often the loop looks for due emails, and the most batches one pass sends. */
const LOOP_MS = 20_000;
const MAX_BATCHES = 10;
const CLEANUP_EVERY_MS = 60 * 60_000;

// Per process: one pass at a time, and the circuit breaker.
let running = false;
/** A kick arrived while a pass was running: run once more when it ends, so nothing waits for the loop. */
let kickedWhileRunning = false;
let consecutiveTransient = 0;
let breakerUntil = 0;

const EMPTY: ProcessResult = { claimed: 0, sent: 0, retried: 0, failed: 0 };

/** One pass over the queue. `by` is recorded as who ran it ("loop", "kick", "admin", "worker"). */
export async function processOutbox(opts: { by?: string; deps?: Partial<EmailQueueDeps> } = {}): Promise<ProcessResult> {
  const deps = { ...defaultDeps, ...opts.deps };
  const by = opts.by ?? "loop";
  if (running) {
    if (by === "kick") kickedWhileRunning = true;
    return { ...EMPTY, skipped: "busy" };
  }
  running = true;
  const result: ProcessResult = { ...EMPTY };
  try {
    if (!(await deps.store.isInstalled())) return { ...EMPTY, skipped: "not-installed" };
    if ((await deps.store.getState()).paused) return { ...EMPTY, skipped: "paused" };
    if (deps.now() < breakerUntil) return { ...EMPTY, skipped: "breaker" };
    const settings = await deps.loadSettings();
    if (!settings || emailConfigProblem(settings)) return { ...EMPTY, skipped: "not-configured" };

    await deps.store.recover(deps.now());
    // Emails the BullMQ driver handed to Redis and that are still not sent
    // (the driver was switched off, or Redis is down): deliver them here.
    const stranded = await deps.store.staleQueued(deps.now() - QUEUED_CHECK_AFTER_MS, 500);
    await deps.store.releaseQueued(stranded, "Delivered without the queue");
    const batchSize = intEnv("EMAIL_BATCH_SIZE", 20, 1, 200);

    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const rows = await deps.store.claim(WORKER_ID, batchSize);
      if (rows.length === 0) break;
      result.claimed += rows.length;

      let configError: string | null = null;
      let batchSent = 0;
      let batchTransient = 0;
      await Promise.all(
        rows.map(async (row) => {
          try {
            if (isExpired(row, deps.now())) {
              await deps.store.apply(row.id, { status: "CANCELLED", error: "Expired before it could be sent" });
              result.failed += 1;
              return;
            }
            const outcome = await deps.transport.send(row, settings);
            const update = rowUpdateFor(row, outcome, deps.now(), deps.random);
            await deps.store.apply(row.id, update);
            if (outcome.kind === "sent") {
              batchSent += 1;
              result.sent += 1;
              logger.info({ event: "email.sent", outboxId: row.id, notificationType: row.notificationType, attempts: row.attempts }, "Email sent");
            } else if (outcome.kind === "config") {
              configError = outcome.error;
              result.retried += 1;
            } else if (update.status === "PENDING") {
              batchTransient += 1;
              result.retried += 1;
              logger.warn({ event: "email.retry", outboxId: row.id, notificationType: row.notificationType, attempts: row.attempts, reason: outcome.error }, "Email will be retried");
            } else {
              if (outcome.kind === "transient") batchTransient += 1;
              result.failed += 1;
              logger.error({ event: "email.failed", outboxId: row.id, notificationType: row.notificationType, attempts: row.attempts, reason: outcome.error }, "Email failed for good");
            }
          } catch (err) {
            // Couldn't record the outcome: the row stays SENDING and recover() releases it later.
            logger.error({ err, event: "email.worker_error", outboxId: row.id }, "Email worker couldn't record an attempt");
          }
        })
      );

      if (configError) {
        // Our credentials / settings are wrong: every email would fail the
        // same way, so stop and wait for an admin instead of burning attempts.
        await deps.store.setPaused(true, configError, "system");
        logger.error({ event: "email.queue_paused", reason: configError }, "Email queue paused - fix the mail settings, then resume it in Settings");
        break;
      }
      if (batchSent > 0) consecutiveTransient = 0;
      else consecutiveTransient += batchTransient;
      if (consecutiveTransient >= BREAKER_THRESHOLD) {
        breakerUntil = deps.now() + BREAKER_PAUSE_MS;
        consecutiveTransient = 0;
        logger.warn({ event: "email.breaker_open", forMs: BREAKER_PAUSE_MS }, "Mail server keeps failing - pausing sends briefly");
        break;
      }
      if (rows.length < batchSize) break;
    }
    if (result.claimed > 0) await deps.store.recordRun(by);
    return result;
  } catch (err) {
    logger.error({ err, event: "email.worker_error" }, "Email worker pass failed");
    return result;
  } finally {
    running = false;
    if (kickedWhileRunning) {
      kickedWhileRunning = false;
      setImmediate(() => void deliverDue({ by: "kick", deps: opts.deps }));
    }
  }
}

/**
 * One delivery pass with the configured driver. BullMQ: recover lost jobs,
 * hand due emails to the queue; when Redis can't be reached, deliver this
 * pass with the Postgres worker instead. Never throws.
 */
let relaying = false;
export async function deliverDue(opts: { by?: string; queue?: JobQueue; deps?: Partial<EmailQueueDeps> } = {}): Promise<ProcessResult> {
  if (queueDriver() !== "bullmq") return processOutbox(opts);
  const deps = { ...defaultDeps, ...opts.deps };
  const queue = opts.queue ?? bullmqJobQueue;
  if (relaying) return { ...EMPTY, skipped: "busy" };
  relaying = true;
  try {
    if (!(await deps.store.isInstalled())) return { ...EMPTY, skipped: "not-installed" };
    if ((await deps.store.getState()).paused) return { ...EMPTY, skipped: "paused" };
    const settings = await deps.loadSettings();
    if (!settings || emailConfigProblem(settings)) return { ...EMPTY, skipped: "not-configured" };

    await deps.store.recover(deps.now());
    const batchSize = intEnv("EMAIL_BATCH_SIZE", 20, 1, 200);
    let handedOff = 0;
    let redisDown = false;
    try {
      await reconcileOnce({ store: deps.store, queue, now: deps.now });
      for (let batch = 0; batch < MAX_BATCHES; batch++) {
        const r = await relayOnce({ store: deps.store, queue, workerId: WORKER_ID }, batchSize);
        handedOff += r.handedOff;
        redisDown = r.redisDown;
        if (redisDown || r.handedOff < batchSize) break;
      }
    } catch (err) {
      redisDown = true;
      logger.warn({ err, event: "email.redis_unavailable" }, "BullMQ isn't reachable - falling back to the Postgres worker");
    }
    if (handedOff > 0) await deps.store.recordRun(opts.by ?? "loop");
    if (!redisDown) return { ...EMPTY, handedOff };
  } catch (err) {
    logger.error({ err, event: "email.worker_error" }, "Email relay pass failed");
    return { ...EMPTY };
  } finally {
    relaying = false;
  }
  // Redis is down: mail must still go out.
  return { ...(await processOutbox(opts)), redisFallback: true };
}

/**
 * Something was just queued: deliver now instead of waiting for the loop.
 * Never throws, never blocks. With BullMQ the hand-off is done here even
 * when the worker is a separate process, so it is pushed to it at once.
 */
export function kickEmailWorker(): void {
  if (workerMode() === "external" && queueDriver() !== "bullmq") return;
  setImmediate(() => {
    void deliverDue({ by: "kick" });
  });
}

/** Starts the in-process loop once per process (hot reloads included). */
export function startEmailWorker(): void {
  if (workerMode() === "external") {
    logger.info({ event: "email.worker_external" }, "Email worker: external mode - this process doesn't deliver email (run `npm run worker:email`)");
    return;
  }
  const g = globalThis as unknown as { __emailWorkerTimer?: ReturnType<typeof setInterval> };
  if (g.__emailWorkerTimer) clearInterval(g.__emailWorkerTimer);
  if (queueDriver() === "bullmq") {
    void startBullmqWorker({ ...defaultDeps, workerId: WORKER_ID }).catch((err) =>
      logger.error({ err, event: "email.bullmq_start_failed" }, "Couldn't start the BullMQ email worker - emails are delivered by the Postgres worker until it starts")
    );
  }
  let lastCleanup = 0;
  g.__emailWorkerTimer = setInterval(() => {
    void (async () => {
      await deliverDue({ by: "loop" });
      if (Date.now() - lastCleanup > CLEANUP_EVERY_MS) {
        lastCleanup = Date.now();
        try {
          if (await prismaEmailQueueStore.isInstalled()) await prismaEmailQueueStore.cleanup(Date.now());
        } catch (err) {
          logger.warn({ err, event: "email.cleanup_failed" }, "Email queue cleanup failed");
        }
      }
    })();
  }, LOOP_MS);
  // Never keeps the process alive on its own.
  g.__emailWorkerTimer.unref?.();
  logger.info({ event: "email.worker_started", everyMs: LOOP_MS, driver: queueDriver() }, "Email worker started");
}

// ---------------------------------------------------------------------------
// Hand-off from updateDb() (src/lib/db.ts)

/**
 * Emails decided on inside an updateDb() mutator. Returns how to commit
 * them: `insert` runs inside the caller's transaction (so they are saved, or
 * rolled back, with the notification), `afterCommit` once it succeeded.
 * Before the migration is applied they are sent directly after the commit.
 */
export async function prepareQueuedEmails(emails: QueuedEmail[], store: EmailQueueStore = prismaEmailQueueStore): Promise<{ insert?: (tx: unknown) => Promise<void>; afterCommit: () => void }> {
  if (emails.length === 0) return { afterCommit: () => {} };
  if (await store.isInstalled()) {
    return { insert: (tx) => store.insert(emails, tx), afterCommit: kickEmailWorker };
  }
  return { afterCommit: () => void sendDirect(emails) };
}

/** No queue tables yet: one attempt each, after the commit, errors logged. */
async function sendDirect(emails: QueuedEmail[]): Promise<void> {
  try {
    const settings = await loadNotificationSettings();
    if (!settings || emailConfigProblem(settings)) return;
    await Promise.all(
      emails.map((e) =>
        smtpEmailTransport.send(
          { id: e.id, notificationType: e.notificationType, toAddress: e.toAddress, fromAddress: e.fromAddress, subject: e.subject, bodyText: e.bodyText, bodyHtml: e.bodyHtml, attempts: 1, maxAttempts: 1, expiresAt: e.expiresAt },
          settings
        )
      )
    );
  } catch (err) {
    logger.error({ err, event: "email.send_failed" }, "Failed to send notification emails");
  }
}

// ---------------------------------------------------------------------------
// Admin (Settings -> Email Queue)

export async function getEmailQueueStatus(): Promise<EmailQueueStatus> {
  const [installed, settings] = await Promise.all([prismaEmailQueueStore.isInstalled(), loadNotificationSettings()]);
  const configProblem = emailConfigProblem(settings);
  let redis: EmailQueueStatus["redis"] = null;
  if (queueDriver() === "bullmq") {
    try {
      redis = { ok: true, ...(await bullmqJobQueue.counts()) };
    } catch {
      redis = { ok: false, waiting: 0, active: 0, delayed: 0 };
    }
  }
  const base = { installed, configured: configProblem === null, configProblem, workerMode: workerMode(), driver: queueDriver(), redis };
  if (!installed) {
    return {
      ...base,
      state: await prismaEmailQueueStore.getState(),
      counts: { PENDING: 0, QUEUED: 0, SENDING: 0, SENT: 0, FAILED: 0, CANCELLED: 0 },
      sentToday: 0,
      oldestPendingAt: null,
      failed: [],
      sent: [],
    };
  }
  const [state, counts] = await Promise.all([prismaEmailQueueStore.getState(), queueCounts()]);
  return { ...base, state, ...counts };
}

export async function pauseEmailQueue(by: string, reason = "Paused by an administrator") {
  return prismaEmailQueueStore.setPaused(true, reason, by);
}

export async function resumeEmailQueue(by: string) {
  breakerUntil = 0;
  consecutiveTransient = 0;
  resetBullmqBreaker();
  const state = await prismaEmailQueueStore.setPaused(false, null, by);
  kickEmailWorker();
  return state;
}

/** Failed email(s) back into the queue with fresh attempts. */
export async function retryFailedEmails(id: string | "all"): Promise<number> {
  const count = await requeueFailed(id, new Date(Date.now() + EXPIRY_MS));
  if (count > 0) kickEmailWorker();
  return count;
}

export async function cancelEmail(id: string): Promise<number> {
  return cancelQueued(id);
}

/** For tests: forget the breaker and the busy flag. */
export function resetEmailWorkerState(): void {
  running = false;
  kickedWhileRunning = false;
  relaying = false;
  consecutiveTransient = 0;
  breakerUntil = 0;
  resetBullmqBreaker();
}

/** For the standalone worker: the BullMQ worker with the default dependencies, and its shutdown. */
export async function startBullmqEmailWorker(): Promise<void> {
  await startBullmqWorker({ ...defaultDeps, workerId: WORKER_ID });
}
export { closeBullmq };
