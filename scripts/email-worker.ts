// Standalone email worker (docs/email-queue.md) - optional.  npm run worker:email
//
// By default the app itself delivers queued emails. Run this instead as its
// own service (and set EMAIL_WORKER=external for the app) when email should
// be delivered by a separate process. Safe to run several: each email is
// taken by exactly one worker.
//
// EMAIL_QUEUE_DRIVER=postgres (default): this process claims due emails from
//   the outbox and sends them.
// EMAIL_QUEUE_DRIVER=bullmq: this process runs the BullMQ worker (Redis pushes
//   it the emails) and, every few seconds, hands off retries that became due
//   and recovers emails whose queue job was lost.
import { closeBullmq, deliverDue, prismaEmailQueueStore, queueDriver, startBullmqEmailWorker } from "@/lib/emailQueue";
import { logger } from "@/lib/logger";

const EVERY_MS = 10_000;
const CLEANUP_EVERY_MS = 60 * 60_000;
let stopping = false;
let lastCleanup = 0;
let wake: (() => void) | null = null;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    wake = () => {
      clearTimeout(timer);
      resolve();
    };
  });

async function main() {
  const driver = queueDriver();
  logger.info({ event: "email.worker_started", mode: "standalone", driver, everyMs: EVERY_MS }, "Email worker started");
  if (driver === "bullmq") await startBullmqEmailWorker();

  while (!stopping) {
    const result = await deliverDue({ by: "worker" });
    if (result.skipped === "not-installed") logger.warn("Email queue tables are missing - apply the migration (docs/email-queue.md)");
    if (Date.now() - lastCleanup > CLEANUP_EVERY_MS) {
      lastCleanup = Date.now();
      if (await prismaEmailQueueStore.isInstalled()) await prismaEmailQueueStore.cleanup(Date.now()).catch((err) => logger.warn({ err }, "Email queue cleanup failed"));
    }
    // A pass that found work may have more waiting: go again at once.
    const busy = result.claimed > 0 || (result.handedOff ?? 0) > 0;
    if (!busy && !stopping) await sleep(EVERY_MS);
  }

  // Graceful shutdown: let the sends in progress finish, then close.
  await closeBullmq();
  logger.info({ event: "email.worker_stopped" }, "Email worker stopped");
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
    wake?.();
  });
}

void main();
