/**
 * Email queue (docs/email-queue.md) - public surface of the module. Server
 * code imports from here; client components import "./types" only, and
 * src/lib/notifications.ts imports "./rules" (pure, no database).
 */
export * from "./types";
export { emailConfigProblem, emailForNotification, escapeHtml, renderNotificationEmail, backoffMs, classifyError, rowUpdateFor, DEFAULT_MAX_ATTEMPTS, BACKOFF_MS } from "./rules";
export { prismaEmailQueueStore, type EmailQueueStore } from "./store";
export { smtpEmailTransport, type EmailTransport } from "./transport";
export { relayOnce, reconcileOnce, handleJob, type JobQueue, type BullmqDeps } from "./bullmq";
export {
  processOutbox,
  deliverDue,
  queueDriver,
  startBullmqEmailWorker,
  closeBullmq,
  kickEmailWorker,
  startEmailWorker,
  prepareQueuedEmails,
  getEmailQueueStatus,
  pauseEmailQueue,
  resumeEmailQueue,
  retryFailedEmails,
  cancelEmail,
  workerMode,
  resetEmailWorkerState,
  type EmailQueueDeps,
} from "./service";
