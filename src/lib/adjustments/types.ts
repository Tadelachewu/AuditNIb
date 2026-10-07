/**
 * Revolving findings - adjustments of a finding's outstanding cases / amount
 * (docs/revolving-findings.md). Client-safe: types and constants only.
 */

export type AdjustmentStatus =
  | "DRAFT"
  | "DISTRICT_REVIEW"
  | "HO_REVIEW"
  | "PENDING_BANK_APPROVAL"
  | "APPROVED"
  | "RETURNED"
  | "REJECTED"
  | "WITHDRAWN";

/** Open = still being worked on; at most one per finding (rule R14). */
export const OPEN_ADJUSTMENT_STATUSES: readonly AdjustmentStatus[] = ["DRAFT", "DISTRICT_REVIEW", "HO_REVIEW", "PENDING_BANK_APPROVAL", "RETURNED"];

/** The review steps (who acts at each is decided in rules.ts). */
export type AdjustmentReviewStep = "DISTRICT_REVIEW" | "HO_REVIEW" | "PENDING_BANK_APPROVAL";
export const REVIEW_STEPS: readonly AdjustmentReviewStep[] = ["DISTRICT_REVIEW", "HO_REVIEW", "PENDING_BANK_APPROVAL"];

export type AdjustmentDecisionKind = "SUBMIT" | "APPROVE" | "RETURN" | "REJECT" | "WITHDRAW" | "EDIT";

export interface AdjustmentDecision {
  /** The status the adjustment was in when this happened. */
  step: AdjustmentStatus;
  decision: AdjustmentDecisionKind;
  by: string;
  byName: string;
  at: string;
  reason?: string;
}

/** Itemized findings: an existing outstanding case's amount change. */
export interface CaseAmountChange {
  caseId: string;
  /** Case number (seq) - for display. */
  seq: number;
  from: number;
  to: number;
}

/** Figures before / after an approved adjustment was applied. */
export interface AdjustmentApplied {
  before: { caseCount: number; amount: number; status: string };
  after: { caseCount: number; amount: number; status: string };
  /** Ids of case rows added (itemized findings). */
  addedCaseIds: string[];
}

export interface FindingAdjustment {
  id: string;
  findingId: string;
  /** The period it was submitted (reported) in - rule R16. */
  periodId: string;
  status: AdjustmentStatus;
  addedCases: number;
  /** The amount change (+/-). Itemized: sum of new case amounts + changes to outstanding cases. */
  amountChange: number;
  /** Itemized findings only. */
  newCaseAmounts: number[];
  caseAmountChanges: CaseAmountChange[];
  reason: string;
  requestedBy: string;
  requestedByName: string;
  /** BANK = bank-wide approval path; BRANCH / DISTRICT = district -> HO path. */
  requesterScope: "BANK" | "DISTRICT" | "BRANCH";
  submittedAt: string | null;
  approvedAt: string | null;
  decisions: AdjustmentDecision[];
  applied: AdjustmentApplied | null;
  createdAt: string;
  updatedAt: string;
}

export const ADJUSTMENT_STATUS_LABELS: Record<AdjustmentStatus, string> = {
  DRAFT: "Draft",
  DISTRICT_REVIEW: "District review",
  HO_REVIEW: "HO review",
  PENDING_BANK_APPROVAL: "Bank-wide approval",
  APPROVED: "Approved",
  RETURNED: "Returned for correction",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
};

/** Settings -> Revolving Findings (table adjustment_config). */
export interface AdjustmentConfig {
  revolvingOperationAreas: string[];
  updatedAt: string | null;
  updatedBy: string | null;
}
