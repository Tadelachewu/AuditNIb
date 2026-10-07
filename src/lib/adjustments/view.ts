import { currentPeriod } from "@/lib/periods";
import type { SessionData } from "@/lib/session";
import type { Database, Finding } from "@/types";
import { caseRowsOf, eligibilityProblem, isEditableByRequester, isRevolvingArea, reviewerProblem, submitProblem } from "./rules";
import type { AdjustmentConfig, FindingAdjustment } from "./types";

/** What this user may do with an adjustment (drives the finding page's buttons). */
export interface AdjustmentActions {
  edit: boolean;
  submit: boolean;
  withdraw: boolean;
  review: boolean;
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
  cases: { id: string; seq: number; amount: number; status: "OUTSTANDING" | "RECTIFIED" }[];
}

function actionsFor(db: Database, session: SessionData, f: Finding, adj: FindingAdjustment): AdjustmentActions {
  const mine = adj.requestedBy === session.userId;
  const editable = mine && isEditableByRequester(adj);
  return {
    edit: editable,
    submit: mine && (adj.status === "DRAFT" || adj.status === "RETURNED"),
    withdraw: editable,
    review: reviewerProblem(db, session, adj, f) === null,
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
    cases: rows.map((c) => ({ id: c.id, seq: c.seq, amount: c.amount, status: c.status })),
  };
}
