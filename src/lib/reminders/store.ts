import { prisma } from "@/lib/prismaClient";
import { logger } from "@/lib/logger";
import type { ReminderRun, ReminderTrigger } from "./types";

/**
 * Storage of the reminder runs - its own table (reminder_runs), nothing
 * else. Plain SQL, so it works with any generated Prisma client. The service
 * depends on this interface, so it is tested without a database.
 */
export interface ReminderStore {
  /** false = the table doesn't exist yet (migration not applied): the old on-poll check keeps running. */
  isInstalled(): Promise<boolean>;
  /** Has the scheduled run of this local date been done? */
  ranOn(runDate: string): Promise<boolean>;
  listRuns(limit: number): Promise<ReminderRun[]>;
  /**
   * Records a run inside the caller's open transaction (`tx`), so it commits
   * with the notifications. Returns false when a run with that id already
   * exists - a second scheduled run of the same day; the caller rolls back.
   */
  saveRun(run: ReminderRun, tx: unknown): Promise<boolean>;
  /** Forgets every run (Dev Reset). `tx` as in saveRun. */
  deleteAll(tx: unknown): Promise<void>;
}

interface RawClient {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}

interface Row {
  id: string;
  run_date: string;
  ran_at: Date;
  triggered_by: string;
  reminded_findings: number;
  notified_users: number;
  finding_references: string[] | null;
}

let installed: boolean | null = null;
let installedCheckedAt = 0;
let warnedMissing = false;

export const prismaReminderStore: ReminderStore = {
  async isInstalled() {
    if (installed === true) return true;
    if (installed === false && Date.now() - installedCheckedAt < 60_000) return false;
    installedCheckedAt = Date.now();
    try {
      const rows = await prisma.$queryRaw<{ ok: boolean }[]>`SELECT to_regclass('reminder_runs') IS NOT NULL AS ok`;
      installed = rows[0]?.ok === true;
    } catch {
      installed = false;
    }
    if (!installed && !warnedMissing) {
      warnedMissing = true;
      logger.warn(
        { event: "reminders.not_installed" },
        "Reminder run table is missing - apply prisma/migrations/20261011120000_reminder_runs (docs/rectification-reminders.md). Until then reminders are only checked while someone is signed in."
      );
    }
    return installed;
  },

  async ranOn(runDate) {
    const rows = await prisma.$queryRaw<{ n: bigint | number }[]>`SELECT count(*) AS n FROM reminder_runs WHERE id = ${runDate}`;
    return Number(rows[0]?.n ?? 0) > 0;
  },

  async listRuns(limit) {
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT id, run_date, ran_at, triggered_by, reminded_findings, notified_users, finding_references
        FROM reminder_runs ORDER BY ran_at DESC LIMIT ${limit}`;
    return rows.map((r) => ({
      id: r.id,
      runDate: r.run_date,
      ranAt: new Date(r.ran_at).toISOString(),
      triggeredBy: r.triggered_by as ReminderTrigger,
      remindedFindings: Number(r.reminded_findings),
      notifiedUsers: Number(r.notified_users),
      findingReferences: r.finding_references ?? [],
    }));
  },

  async saveRun(run, tx) {
    const inserted = await (tx as RawClient).$executeRaw`
      INSERT INTO reminder_runs (id, run_date, ran_at, triggered_by, reminded_findings, notified_users, finding_references)
      VALUES (${run.id}, ${run.runDate}, ${new Date(run.ranAt)}, ${run.triggeredBy}, ${run.remindedFindings}, ${run.notifiedUsers}, ${run.findingReferences}::text[])
      ON CONFLICT (id) DO NOTHING`;
    return inserted > 0;
  },

  async deleteAll(tx) {
    await (tx as RawClient).$executeRaw`DELETE FROM reminder_runs`;
  },
};
