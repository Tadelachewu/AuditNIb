import { prisma } from "@/lib/prismaClient";
import { logger } from "@/lib/logger";
import type { AdjustmentConfig } from "./types";

/**
 * Settings -> Revolving Findings: its own singleton table (adjustment_config).
 * A missing table (migration not applied) reads as "no areas listed", so no
 * finding can be adjusted until the migration is applied.
 */

const SINGLETON = "singleton";
export const EMPTY_ADJUSTMENT_CONFIG: AdjustmentConfig = { revolvingOperationAreas: [], updatedAt: null, updatedBy: null };

function isMissingTable(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2021";
}

let warnedMissing = false;

function toConfig(r: { revolvingOperationAreas: string[]; updatedAt: Date; updatedBy: string | null }): AdjustmentConfig {
  return { revolvingOperationAreas: r.revolvingOperationAreas, updatedAt: r.updatedAt.toISOString(), updatedBy: r.updatedBy };
}

/** Trims, drops blanks and case-insensitive duplicates, sorts. */
export function normalizeAreas(areas: string[]): string[] {
  const seen = new Map<string, string>();
  for (const raw of areas) {
    const area = raw.trim().replace(/\s+/g, " ");
    if (area && !seen.has(area.toLowerCase())) seen.set(area.toLowerCase(), area);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

export async function getAdjustmentConfig(): Promise<AdjustmentConfig> {
  try {
    const row = await prisma.adjustmentConfig.findUnique({ where: { id: SINGLETON } });
    return row ? toConfig(row) : { ...EMPTY_ADJUSTMENT_CONFIG };
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    if (!warnedMissing) {
      warnedMissing = true;
      logger.warn(
        { event: "adjustments.not_installed" },
        "Revolving-findings tables are missing - apply prisma/migrations/20261007120000_revolving_findings (docs/revolving-findings.md). Adjustments stay off until then."
      );
    }
    return { ...EMPTY_ADJUSTMENT_CONFIG };
  }
}

export async function saveAdjustmentConfig(revolvingOperationAreas: string[], updatedBy: string): Promise<AdjustmentConfig> {
  const data = { revolvingOperationAreas: normalizeAreas(revolvingOperationAreas), updatedAt: new Date(), updatedBy };
  const row = await prisma.adjustmentConfig.upsert({ where: { id: SINGLETON }, create: { id: SINGLETON, ...data }, update: data });
  return toConfig(row);
}
