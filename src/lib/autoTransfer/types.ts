/**
 * Automatic transfer at period end - a self-contained module
 * (src/lib/autoTransfer). When a reporting period has ended, every finding
 * still outstanding in it is carried into the next period, once, except
 * findings whose operation area is excluded. See docs/auto-transfer.md.
 *
 * Client-safe: types and constants only.
 */

/** The module's own settings (table auto_transfer_config, one row). */
export interface AutoTransferConfig {
  /** Master switch. */
  enabled: boolean;
  /** Findings with one of these operation areas are never moved automatically (matched case- and space-insensitively). */
  excludedOperationAreas: string[];
  /** Run this many hours after the period's end (and its submission window's end). */
  delayHours: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export const DEFAULT_AUTO_TRANSFER_CONFIG: AutoTransferConfig = {
  enabled: true,
  excludedOperationAreas: [],
  delayHours: 0,
  updatedAt: null,
  updatedBy: null,
};

/**
 * What happened to one period (table auto_transfer_runs, one row per period):
 *  DONE                - swept: outstanding findings moved to the next period
 *  WAITING_NO_NEXT     - due, but the next period doesn't exist yet; retried until it does
 *  SKIPPED_AT_RELEASE  - had already ended when this feature was installed; never swept
 */
export type AutoTransferRunStatus = "DONE" | "WAITING_NO_NEXT" | "SKIPPED_AT_RELEASE";

/** What started a sweep: a scheduler calling /api/system/auto-transfer, or the check made while people use the app. */
export type AutoTransferTrigger = "scheduler" | "in-app";

export interface AutoTransferRun {
  periodId: string;
  status: AutoTransferRunStatus;
  toPeriodId: string | null;
  movedCount: number;
  keptCount: number;
  movedReferences: string[];
  keptReferences: string[];
  ranAt: string;
  /** null = recorded before triggers were tracked (or at install). */
  triggeredBy: AutoTransferTrigger | null;
}

/** A period counts as handled (never swept again) once its run is DONE or SKIPPED_AT_RELEASE. */
export function isHandled(run: AutoTransferRun | undefined): boolean {
  return run?.status === "DONE" || run?.status === "SKIPPED_AT_RELEASE";
}

/** The actor recorded on automatic transfers (history, audit log, Transfers report). */
export const SYSTEM_ACTOR = { userId: "system", userName: "System (automatic transfer)" } as const;
