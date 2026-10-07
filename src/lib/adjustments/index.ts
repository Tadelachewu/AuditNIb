/**
 * Revolving findings - adjustments of a finding's outstanding cases / amount
 * (docs/revolving-findings.md). Public surface of the module: server code
 * imports from here; client components import "./types" (and type-only "./view").
 */
export * from "./types";
export {
  caseRowsOf,
  eligibilityProblem,
  firstStep,
  isEditableByRequester,
  isOutstanding,
  isReviewStep,
  isRevolvingArea,
  nextStep,
  openAdjustmentOf,
  rectificationStatusAfter,
  requesterProblem,
  resolveChange,
  reviewerProblem,
  submitProblem,
  type AdjustmentInput,
  type ResolvedChange,
} from "./rules";
export { createAdjustment, editAdjustment, submitAdjustment, withdrawAdjustment, reviewAdjustment, type ReviewDecision } from "./service";
export { getAdjustmentConfig, saveAdjustmentConfig, normalizeAreas, EMPTY_ADJUSTMENT_CONFIG } from "./config";
export { adjustmentsView, type AdjustmentsView, type AdjustmentWithActions, type AdjustmentActions } from "./view";
