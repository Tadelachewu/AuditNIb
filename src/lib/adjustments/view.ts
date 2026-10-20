import { approvedAdjustmentsOf, originalPeriodId } from "@/lib/findings";
import { currentPeriod } from "@/lib/periods";
import type { SessionData } from "@/lib/session";
import type { Database, Finding } from "@/types";
import { caseRowsOf, eligibilityProblem, isEditableByRequester, isRevolvingArea, reviewerProblem, submitProblem } from "./rules";
import { canDeleteAdjustment } from "./service";
import type { AdjustmentConfig, FindingAdjustment } from "./types";

/** What this user may do with an adjustment (drives the finding page's buttons). */
export interface AdjustmentActions {
  edit: boolean;
  submit: boolean;
  withdraw: boolean;
  review: boolean;
  delete: boolean;
}

export type AdjustmentWithActions = FindingAdjustment & { can: AdjustmentActions };

/** GET /api/findings/[id]/adjustments - the finding's adjustments as this user sees them. */
export interface AdjustmentsView {
  adjustments: AdjustmentWithActions[];
  /** The finding's operation area is listed in Settings -> Revolving Findings. */
  revolving: boolean;
  canStart: boolean;
  startProblem: string | null;
  /** Why submitting isn't possible right now (window closed / locked) - drafts still are. */
  submitProblem: string | null;
  itemized: boolean;
  cases: { id: string; seq: number; amount: number; status: "OUTSTANDING" | "RECTIFIED"; description: string | null }[];
  /**
   * A transferred finding's stay in the period it is in now: what the last
   * transfer carried in plus adjustments approved since - its total in this
   * period (closed work stays with the periods it was closed in). null =
   * never transferred (its whole total is in this period).
   */
  /**
   * A transferred-in finding's figures in the period it is in now:
   * `transferredCases` / `transferredAmount` = what the transfer carried in
   * (shown on the card); `cases` / `amount` = that plus adjustments approved
   * since (the dialog's in-period total before / after an adjustment).
   */
  periodStay: { periodCode: string; fromPeriodCode: string; transferredCases: number; transferredAmount: number; cases: number; amount: number } | null;
}

function periodStayOf(db: Database, f: Finding): AdjustmentsView["periodStay"] {
  const last = db.findingTransfers.filter((t) => t.findingId === f.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
  if (!last) return null;
  // Transferred back to the period it was registered in: it's home again, not
  // a transferred-in stay - the card shows its current total (original +
  // approved adjustments), as for a finding that never moved.
  if (last.toPeriodId === originalPeriodId(db, f)) return null;
  // Same rule as the period figures (findingResidencyInPeriod): an adjustment
  // approved after the transfer joins this stay.
  const since = approvedAdjustmentsOf(db, f.id).filter((a) => new Date(a.approvedAt!).getTime() >= new Date(last.createdAt).getTime());
  const code = (id: string) => db.reportingPeriods.find((p) => p.id === id)?.code ?? "";
  return {
    periodCode: code(last.toPeriodId),
    fromPeriodCode: code(last.fromPeriodId),
    transferredCases: last.casesTransferred,
    transferredAmount: last.amountTransferred,
    cases: last.casesTransferred + since.reduce((n, a) => n + a.addedCases, 0),
    amount: Math.round((last.amountTransferred + since.reduce((n, a) => n + a.amountChange, 0)) * 100) / 100,
  };
}

function actionsFor(db: Database, session: SessionData, f: Finding, adj: FindingAdjustment): AdjustmentActions {
  const mine = adj.requestedBy === session.userId;
  const editable = mine && isEditableByRequester(adj);
  return {
    edit: editable,
    submit: mine && (adj.status === "DRAFT" || adj.status === "RETURNED"),
    withdraw: editable,
    review: reviewerProblem(db, session, adj, f) === null,
    delete: canDeleteAdjustment(session, adj),
  };
}

export function adjustmentsView(db: Database, config: AdjustmentConfig, session: SessionData, f: Finding): AdjustmentsView {
  const startProblem = eligibilityProblem(db, config, session, f);
  const current = currentPeriod(db.reportingPeriods);
  const rows = caseRowsOf(db, f.id);
  return {
    adjustments: (db.findingAdjustments ?? [])
      .filter((a) => a.findingId === f.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((a) => ({ ...a, can: actionsFor(db, session, f, a) })),
    revolving: isRevolvingArea(config, f.operationArea),
    canStart: startProblem === null,
    startProblem,
    submitProblem: current ? submitProblem(db, current.id) : "There is no current reporting period",
    itemized: rows.length > 0,
    cases: rows.map((c) => ({ id: c.id, seq: c.seq, amount: c.amount, status: c.status, description: c.description?.trim() || null })),
    periodStay: periodStayOf(db, f),
  };
}
