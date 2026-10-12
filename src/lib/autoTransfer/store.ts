import { prisma } from "@/lib/prismaClient";
import type { Prisma } from "@/generated/prisma/client";
import { logger } from "@/lib/logger";
import { DEFAULT_AUTO_TRANSFER_CONFIG, type AreaSources, type AutoTransferConfig, type AutoTransferRun, type AutoTransferRunStatus, type AutoTransferTrigger } from "./types";

/**
 * Storage of the automatic transfer - its own two tables, nothing else.
 * The service depends on this interface, not on Prisma, so it can be tested
 * (or moved to another store) without touching the rest of the app.
 */
export interface AutoTransferStore {
  /** null = the tables don't exist yet (migration not applied): the feature stays idle. */
  getConfig(): Promise<AutoTransferConfig | null>;
  saveConfig(config: Pick<AutoTransferConfig, "enabled" | "includedAreaSources" | "delayHours">, updatedBy: string): Promise<AutoTransferConfig>;
  listRuns(): Promise<AutoTransferRun[]>;
  /**
   * Records runs. `tx` = an open database transaction (an opaque handle from
   * the caller) so the record commits together with the moved findings;
   * without it the store opens its own.
   */
  saveRuns(runs: AutoTransferRun[], tx?: unknown): Promise<void>;
  /** Forgets runs ("all", or these periods) so those periods become due again. `tx` as in saveRuns. */
  deleteRuns(periodIds: string[] | "all", tx?: unknown): Promise<void>;
}

const SINGLETON = "singleton";

/** Prisma "table does not exist" - the migration hasn't been applied yet. */
function isMissingTable(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2021";
}

/** The settings row can't be saved: the database is behind on the automatic-transfer migrations. */
export class AutoTransferNotMigratedError extends Error {
  constructor() {
    super("Apply the latest automatic transfer migrations (npx prisma migrate deploy) before changing automatic transfer.");
    this.name = "AutoTransferNotMigratedError";
  }
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

/**
 * The settings row as JSON, whatever columns it has. Read and written with
 * plain SQL so the store works on a database that is behind on the
 * automatic-transfer migrations (and doesn't depend on a regenerated Prisma
 * client). The area list has had three shapes, newest first:
 *   included_area_sources    [{ operationArea, sourceIds }]
 *   included_operation_areas areas transferred, any source
 *   excluded_operation_areas areas left behind
 */
type ConfigRow = {
  enabled: boolean;
  included_area_sources?: unknown;
  included_operation_areas?: string[];
  excluded_operation_areas?: string[];
  delay_hours: number;
  updated_at: string;
  updated_by: string | null;
};

function toAreaSources(raw: unknown): AreaSources[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    const row = r as { operationArea?: unknown; sourceIds?: unknown };
    if (typeof row?.operationArea !== "string" || !Array.isArray(row.sourceIds)) return [];
    return [{ operationArea: row.operationArea, sourceIds: row.sourceIds.filter((id): id is string => typeof id === "string") }];
  });
}

/** Which older list a database behind on migrations still holds. */
function legacyOf(r: Pick<ConfigRow, "included_area_sources" | "included_operation_areas" | "excluded_operation_areas">): AutoTransferConfig["legacy"] {
  if (r.included_area_sources !== undefined) return undefined;
  if (r.included_operation_areas !== undefined) return { includedOperationAreas: r.included_operation_areas };
  return { excludedOperationAreas: r.excluded_operation_areas ?? [] };
}

function toConfig(r: ConfigRow): AutoTransferConfig {
  const legacy = legacyOf(r);
  return {
    enabled: r.enabled,
    includedAreaSources: toAreaSources(r.included_area_sources),
    ...(legacy ? { legacy } : {}),
    delayHours: r.delay_hours,
    // Stored as UTC wall-clock, without a zone.
    updatedAt: new Date(/Z|[+-]\d\d(:?\d\d)?$/.test(r.updated_at) ? r.updated_at : `${r.updated_at}Z`).toISOString(),
    updatedBy: r.updated_by,
  };
}

/** The area-list columns the settings table has right now. */
async function areaColumns(): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name::text AS column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'auto_transfer_config'`;
  return new Set(rows.map((r) => r.column_name));
}

let warnedLegacy = false;

export const prismaAutoTransferStore: AutoTransferStore = {
  async getConfig() {
    try {
      const installed = await prisma.$queryRaw<{ installed: boolean }[]>`SELECT to_regclass('public.auto_transfer_config') IS NOT NULL AS installed`;
      if (!installed[0]?.installed) {
        warnMissingOnce();
        return null;
      }
      const rows = await prisma.$queryRaw<{ row: ConfigRow }[]>`SELECT to_jsonb(c) AS row FROM auto_transfer_config c WHERE c.id = ${SINGLETON}`;
      if (rows[0]) {
        const config = toConfig(rows[0].row);
        if (config.legacy && !warnedLegacy) {
          warnedLegacy = true;
          logger.warn(
            { event: "auto_transfer.migration_pending" },
            "Automatic transfer still uses an older operation-area list - apply the pending migrations (npx prisma migrate deploy)."
          );
        }
        return config;
      }
      // No settings saved yet. On the oldest layout that meant "transfer everything".
      const cols = await areaColumns();
      const legacy = legacyOf({
        included_area_sources: cols.has("included_area_sources") ? [] : undefined,
        included_operation_areas: cols.has("included_operation_areas") ? [] : undefined,
      });
      return { ...DEFAULT_AUTO_TRANSFER_CONFIG, ...(legacy ? { legacy } : {}) };
    } catch (err) {
      if (isMissingTable(err)) {
        warnMissingOnce();
        return null;
      }
      throw err;
    }
  },

  async saveConfig(config, updatedBy) {
    if (!(await areaColumns()).has("included_area_sources")) throw new AutoTransferNotMigratedError();
    // Stored times are UTC wall-clock: never bare now() (the DB session may be in another zone).
    const rows = await prisma.$queryRaw<{ row: ConfigRow }[]>`
      INSERT INTO auto_transfer_config AS c (id, enabled, included_area_sources, delay_hours, updated_at, updated_by)
      VALUES (${SINGLETON}, ${config.enabled}, ${JSON.stringify(config.includedAreaSources)}::jsonb, ${config.delayHours}, (now() AT TIME ZONE 'UTC'), ${updatedBy})
      ON CONFLICT (id) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        included_area_sources = EXCLUDED.included_area_sources,
        delay_hours = EXCLUDED.delay_hours,
        updated_at = EXCLUDED.updated_at,
        updated_by = EXCLUDED.updated_by
      RETURNING to_jsonb(c) AS row`;
    return toConfig(rows[0].row);
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

  async deleteRuns(periodIds, tx) {
    const client = (tx as Prisma.TransactionClient | undefined) ?? prisma;
    try {
      if (periodIds === "all") await client.autoTransferRun.deleteMany({});
      else if (periodIds.length > 0) await client.autoTransferRun.deleteMany({ where: { periodId: { in: periodIds } } });
    } catch (err) {
      if (isMissingTable(err)) return warnMissingOnce(); // not installed: nothing to forget
      throw err;
    }
  },
};
