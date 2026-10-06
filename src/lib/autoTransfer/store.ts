import { prisma } from "@/lib/prismaClient";
import type { Prisma } from "@/generated/prisma/client";
import { logger } from "@/lib/logger";
import { DEFAULT_AUTO_TRANSFER_CONFIG, type AutoTransferConfig, type AutoTransferRun, type AutoTransferRunStatus, type AutoTransferTrigger } from "./types";

/**
 * Storage of the automatic transfer - its own two tables, nothing else.
 * The service depends on this interface, not on Prisma, so it can be tested
 * (or moved to another store) without touching the rest of the app.
 */
export interface AutoTransferStore {
  /** null = the tables don't exist yet (migration not applied): the feature stays idle. */
  getConfig(): Promise<AutoTransferConfig | null>;
  saveConfig(config: Pick<AutoTransferConfig, "enabled" | "excludedOperationAreas" | "delayHours">, updatedBy: string): Promise<AutoTransferConfig>;
  listRuns(): Promise<AutoTransferRun[]>;
  /**
   * Records runs. `tx` = an open database transaction (an opaque handle from
   * the caller) so the record commits together with the moved findings;
   * without it the store opens its own.
   */
  saveRuns(runs: AutoTransferRun[], tx?: unknown): Promise<void>;
}

const SINGLETON = "singleton";

/** Prisma "table does not exist" - the migration hasn't been applied yet. */
function isMissingTable(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2021";
}

let warnedMissing = false;
function warnMissingOnce() {
  if (warnedMissing) return;
  warnedMissing = true;
  logger.warn(
    { event: "auto_transfer.not_installed" },
    "Automatic transfer tables are missing - apply prisma/migrations/20261006120000_auto_transfer_at_period_end (see docs/auto-transfer.md). Automatic transfer stays off until then."
  );
}

function toConfig(r: { enabled: boolean; excludedOperationAreas: string[]; delayHours: number; updatedAt: Date; updatedBy: string | null }): AutoTransferConfig {
  return {
    enabled: r.enabled,
    excludedOperationAreas: r.excludedOperationAreas,
    delayHours: r.delayHours,
    updatedAt: r.updatedAt.toISOString(),
    updatedBy: r.updatedBy,
  };
}

export const prismaAutoTransferStore: AutoTransferStore = {
  async getConfig() {
    try {
      const row = await prisma.autoTransferConfig.findUnique({ where: { id: SINGLETON } });
      return row ? toConfig(row) : { ...DEFAULT_AUTO_TRANSFER_CONFIG };
    } catch (err) {
      if (isMissingTable(err)) {
        warnMissingOnce();
        return null;
      }
      throw err;
    }
  },

  async saveConfig(config, updatedBy) {
    const data = {
      enabled: config.enabled,
      excludedOperationAreas: config.excludedOperationAreas,
      delayHours: config.delayHours,
      updatedAt: new Date(),
      updatedBy,
    };
    const row = await prisma.autoTransferConfig.upsert({ where: { id: SINGLETON }, create: { id: SINGLETON, ...data }, update: data });
    return toConfig(row);
  },

  async listRuns() {
    try {
      const rows = await prisma.autoTransferRun.findMany();
      return rows.map((r) => ({
        periodId: r.periodId,
        status: r.status as AutoTransferRunStatus,
        toPeriodId: r.toPeriodId,
        movedCount: r.movedCount,
        keptCount: r.keptCount,
        movedReferences: r.movedReferences,
        keptReferences: r.keptReferences,
        ranAt: r.ranAt.toISOString(),
        triggeredBy: (r.triggeredBy as AutoTransferTrigger | null) ?? null,
      }));
    } catch (err) {
      if (isMissingTable(err)) {
        warnMissingOnce();
        return [];
      }
      throw err;
    }
  },

  async saveRuns(runs, tx) {
    if (runs.length === 0) return;
    const write = async (client: Prisma.TransactionClient) => {
      for (const r of runs) {
        const data = {
          status: r.status,
          toPeriodId: r.toPeriodId,
          movedCount: r.movedCount,
          keptCount: r.keptCount,
          movedReferences: r.movedReferences,
          keptReferences: r.keptReferences,
          ranAt: new Date(r.ranAt),
          triggeredBy: r.triggeredBy,
        };
        await client.autoTransferRun.upsert({ where: { periodId: r.periodId }, create: { periodId: r.periodId, ...data }, update: data });
      }
    };
    if (tx) await write(tx as Prisma.TransactionClient);
    else await prisma.$transaction((client) => write(client));
  },
};
