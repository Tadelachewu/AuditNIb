import { logger } from "@/lib/logger";
import type { NotificationSettings } from "@/types";
import { BREAKER_PAUSE_MS, BREAKER_THRESHOLD, QUEUED_CHECK_AFTER_MS, emailConfigProblem, isExpired, rowUpdateFor } from "./rules";
import type { EmailQueueStore } from "./store";
import { POOL_SIZE, RATE_PER_SECOND, type EmailTransport } from "./transport";

/**
 * BullMQ delivery for the email queue (docs/email-queue.md §8).
 *
 * The Postgres outbox stays the source of truth and the scheduler: it holds
 * every email, its status, attempts and next retry time. BullMQ (on Redis) is
 * the dispatcher - it pushes due emails to workers at once, with a
 * concurrency and a rate limit.
 *
 *   relay     due outbox rows  -> status QUEUED + one BullMQ job each (job id = outbox id)
 *   worker    takes a job      -> QUEUED -> SENDING -> SENT / back to PENDING with a retry time / FAILED
 *   reconcile QUEUED rows whose job is gone from Redis -> back to PENDING
 *
 * A job is ONE attempt. A failed attempt is rescheduled in the outbox, not in
 * Redis, so losing Redis never loses an email or its retries.
 */

/** What the relay and the checks need from a job queue - BullMQ in production, a fake in tests. */
export interface JobQueue {
  /** Adds one job per id. Adding an id that is already queued is a no-op. */
  addMany(jobs: { id: string; priority: number }[]): Promise<void>;
  /** Which of these ids still have a job. */
  existing(ids: string[]): Promise<Set<string>>;
  counts(): Promise<{ waiting: number; active: number; delayed: number }>;
}

export interface BullmqDeps {
  store: EmailQueueStore;
  queue: JobQueue;
  transport: EmailTransport;
  loadSettings: () => Promise<NotificationSettings | undefined>;
  now: () => number;
  random: () => number;
  workerId: string;
}

export const QUEUE_NAME = "email-outbox";

// Circuit breaker for the BullMQ worker (per process).
let consecutiveTransient = 0;
let breakerUntil = 0;
export function resetBullmqBreaker(): void {
  consecutiveTransient = 0;
  breakerUntil = 0;
}

/**
 * Hands due emails to BullMQ. If Redis can't take them, they go straight
 * back to PENDING and `redisDown` tells the caller to deliver with the
 * Postgres worker instead - Redis is never allowed to hold mail hostage.
 */
export async function relayOnce(deps: Pick<BullmqDeps, "store" | "queue" | "workerId">, limit: number): Promise<{ handedOff: number; redisDown: boolean }> {
  const rows = await deps.store.handOff(deps.workerId, limit);
  if (rows.length === 0) return { handedOff: 0, redisDown: false };
  try {
    await deps.queue.addMany(rows);
    return { handedOff: rows.length, redisDown: false };
  } catch (err) {
    await deps.store.releaseQueued(rows.map((r) => r.id), "Redis was unavailable - delivered without the queue");
    logger.warn({ err, event: "email.redis_unavailable", rows: rows.length }, "Couldn't hand emails to BullMQ - falling back to the Postgres worker");
    return { handedOff: 0, redisDown: true };
  }
}

/**
 * Rows handed off a while ago whose job no longer exists in Redis (Redis was
 * flushed, restarted without persistence, or the job was removed): back to
 * PENDING, so the relay hands them off again. Returns how many were recovered.
 */
export async function reconcileOnce(deps: Pick<BullmqDeps, "store" | "queue" | "now">, limit = 200): Promise<number> {
  const ids = await deps.store.staleQueued(deps.now() - QUEUED_CHECK_AFTER_MS, limit);
  if (ids.length === 0) return 0;
  const alive = await deps.queue.existing(ids);
  const lost = ids.filter((id) => !alive.has(id));
  await deps.store.touchQueued(ids.filter((id) => alive.has(id)));
  if (lost.length > 0) {
    await deps.store.releaseQueued(lost, "Its queue job was lost - queued again");
    logger.warn({ event: "email.jobs_recovered", count: lost.length }, "Emails whose queue job was lost were queued again");
  }
  return lost.length;
}

export type JobResult = "sent" | "retry" | "failed" | "cancelled" | "skipped" | "paused";

/** One BullMQ job = one attempt at one outbox row. Never throws for a mail problem: the outbox records the outcome. */
export async function handleJob(id: string, deps: Omit<BullmqDeps, "queue">): Promise<JobResult> {
  // Paused by an admin (or by a credentials failure), or the mail server keeps
  // failing: leave the email in the outbox; the relay hands it off again later.
  if ((await deps.store.getState()).paused) {
    await deps.store.releaseQueued([id], "The queue is paused");
    return "paused";
  }
  if (deps.now() < breakerUntil) {
    await deps.store.releaseQueued([id], "The mail server keeps failing - waiting", breakerUntil);
    return "paused";
  }

  const row = await deps.store.claimQueued(id, deps.workerId);
  // Not QUEUED any more: already sent, cancelled, or handed back - nothing to do.
  if (!row) return "skipped";

  if (isExpired(row, deps.now())) {
    await deps.store.apply(row.id, { status: "CANCELLED", error: "Expired before it could be sent" });
    return "cancelled";
  }
  const settings = await deps.loadSettings();
  const problem = emailConfigProblem(settings);
  const outcome = !settings || problem ? ({ kind: "config", error: problem ?? "Email isn't configured" } as const) : await deps.transport.send(row, settings);
  const update = rowUpdateFor(row, outcome, deps.now(), deps.random);
  await deps.store.apply(row.id, update);

  if (outcome.kind === "sent") {
    consecutiveTransient = 0;
    logger.info({ event: "email.sent", outboxId: row.id, notificationType: row.notificationType, attempts: row.attempts, via: "bullmq" }, "Email sent");
    return "sent";
  }
  if (outcome.kind === "config") {
    await deps.store.setPaused(true, outcome.error, "system");
    logger.error({ event: "email.queue_paused", reason: outcome.error }, "Email queue paused - fix the mail settings, then resume it in Settings");
    return "paused";
  }
  if (outcome.kind === "transient" && ++consecutiveTransient >= BREAKER_THRESHOLD) {
    breakerUntil = deps.now() + BREAKER_PAUSE_MS;
    consecutiveTransient = 0;
    logger.warn({ event: "email.breaker_open", forMs: BREAKER_PAUSE_MS }, "Mail server keeps failing - pausing sends briefly");
  }
  if (update.status === "PENDING") {
    logger.warn({ event: "email.retry", outboxId: row.id, notificationType: row.notificationType, attempts: row.attempts, reason: outcome.error }, "Email will be retried");
    return "retry";
  }
  logger.error({ event: "email.failed", outboxId: row.id, notificationType: row.notificationType, attempts: row.attempts, reason: outcome.error }, "Email failed for good");
  return "failed";
}

// ---------------------------------------------------------------------------
// The real BullMQ queue and worker (loaded only when the BullMQ driver is on)

type BullQueue = import("bullmq").Queue;
type BullWorker = import("bullmq").Worker;

const g = globalThis as unknown as { __emailBullQueue?: BullQueue; __emailBullWorker?: BullWorker };

function redisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL must be set to use the BullMQ email driver");
  return url;
}

/** Fails fast: a producer must never hang a request (or the relay) while Redis is down. */
function producerConnection() {
  return { url: redisUrl(), maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 2000, retryStrategy: (times: number) => Math.min(times * 1000, 30_000) };
}
/** Waits and reconnects for ever: what BullMQ requires of a worker. */
function workerConnection() {
  return { url: redisUrl(), maxRetriesPerRequest: null, retryStrategy: (times: number) => Math.min(times * 1000, 30_000) };
}

async function bullQueue(): Promise<BullQueue> {
  if (g.__emailBullQueue) return g.__emailBullQueue;
  const { Queue } = await import("bullmq");
  const queue = new Queue(QUEUE_NAME, { connection: producerConnection() });
  // Without a listener a dropped connection is an unhandled 'error' event.
  queue.on("error", () => {});
  g.__emailBullQueue = queue;
  return queue;
}

function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([work, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms).unref?.())]);
}

/** BullMQ priority: 1 is the most urgent. Ours: higher number = more urgent. */
const bullPriority = (priority: number) => (priority > 0 ? 1 : 10);

export const bullmqJobQueue: JobQueue = {
  async addMany(jobs) {
    const queue = await bullQueue();
    await withTimeout(
      queue.addBulk(
        jobs.map((j) => ({
          name: "send",
          data: { id: j.id },
          // One attempt per job (retries are scheduled by the outbox); finished
          // jobs are removed so the same email can be handed off again later.
          opts: { jobId: j.id, priority: bullPriority(j.priority), attempts: 1, removeOnComplete: true, removeOnFail: true },
        }))
      ),
      5000,
      "Handing emails to BullMQ"
    );
  },
  async existing(ids) {
    const queue = await bullQueue();
    const found = await withTimeout(Promise.all(ids.map(async (id) => ((await queue.getJob(id)) ? id : null))), 5000, "Checking BullMQ jobs");
    return new Set(found.filter((id): id is string => id !== null));
  },
  async counts() {
    const queue = await bullQueue();
    const c = await withTimeout(queue.getJobCounts("waiting", "prioritized", "active", "delayed"), 3000, "Reading BullMQ counts");
    return { waiting: (c.waiting ?? 0) + (c.prioritized ?? 0), active: c.active ?? 0, delayed: c.delayed ?? 0 };
  },
};

/** Starts the BullMQ worker once per process. `deps.queue` isn't needed - the worker reads jobs itself. */
export async function startBullmqWorker(deps: Omit<BullmqDeps, "queue">): Promise<void> {
  if (g.__emailBullWorker) await g.__emailBullWorker.close().catch(() => {});
  const { Worker } = await import("bullmq");
  const worker = new Worker(QUEUE_NAME, async (job) => handleJob(String((job.data as { id: string }).id), deps), {
    connection: workerConnection(),
    concurrency: POOL_SIZE(),
    limiter: { max: RATE_PER_SECOND(), duration: 1000 },
    // An attempt holds its job for up to 60 s (SMTP timeouts are 10-20 s).
    lockDuration: 60_000,
  });
  worker.on("error", (err) => logger.warn({ err, event: "email.bullmq_error" }, "BullMQ worker error"));
  // Our handler never throws for a mail problem, so this is a database or programming error.
  worker.on("failed", (job, err) => logger.error({ err, event: "email.worker_error", outboxId: job?.id }, "Email job failed unexpectedly"));
  g.__emailBullWorker = worker;
  logger.info({ event: "email.bullmq_worker_started", concurrency: POOL_SIZE(), ratePerSecond: RATE_PER_SECOND() }, "BullMQ email worker started");
}

/** Finishes the jobs in progress, then closes the worker and the queue (graceful shutdown). */
export async function closeBullmq(): Promise<void> {
  await g.__emailBullWorker?.close().catch(() => {});
  await g.__emailBullQueue?.close().catch(() => {});
  g.__emailBullWorker = undefined;
  g.__emailBullQueue = undefined;
}
