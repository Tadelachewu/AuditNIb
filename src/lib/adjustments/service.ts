import { v4 as uuid } from "uuid";
import { appendAuditLog } from "@/lib/audit";
import { AuthorizationError, BusinessRuleError, NotFoundError, ValidationError } from "@/lib/errors";
import { notifyFindingsPermissionHolders, notifyUsers, usersWithFindingsPermission } from "@/lib/notifications";
import { currentPeriod } from "@/lib/periods";
import type { SessionData } from "@/lib/session";
import type { Database, Finding, FindingCase } from "@/types";
import {
  caseRowsOf,
  eligibilityProblem,
  firstStep,
  isEditableByRequester,
  isOutstanding,
  isReviewStep,
  isRevolvingArea,
  nextStep,
  rectificationStatusAfter,
  requesterProblem,
  resolveChange,
  reviewerProblem,
  submitProblem,
  type AdjustmentInput,
  type ResolvedChange,
} from "./rules";
import type { AdjustmentConfig, AdjustmentDecision, AdjustmentDecisionKind, AdjustmentStatus, FindingAdjustment } from "./types";

/**
 * Workflow of revolving-finding adjustments (docs/revolving-findings.md §2-§3).
 * Every function mutates the Database model it is given - call it inside
 * updateDb() so the adjustment, the finding and their history commit
 * together. Rule violations throw ApplicationErrors (handled by withApiHandler).
 */

export type ReviewDecision = "APPROVE" | "RETURN" | "REJECT";

interface Actor {
  userId: string;
  name: string;
}

function actorOf(session: SessionData): Actor {
  if (!session.userId) throw new AuthorizationError();
  return { userId: session.userId, name: session.name ?? "" };
}

function findingOf(db: Database, findingId: string): Finding {
  const f = db.findings.find((x) => x.id === findingId);
  if (!f) throw new NotFoundError("Finding");
  return f;
}

function adjustmentOf(db: Database, findingId: string, adjustmentId: string): FindingAdjustment {
  const adj = (db.findingAdjustments ?? []).find((a) => a.id === adjustmentId && a.findingId === findingId);
  if (!adj) throw new NotFoundError("Adjustment");
  return adj;
}

function rule(problem: string | null): void {
  if (problem) throw new BusinessRuleError("BUSINESS_RULE_VIOLATION", problem);
}

function resolved(db: Database, f: Finding, input: AdjustmentInput): ResolvedChange {
  const r = resolveChange(db, f, input);
  if (!r.ok) throw new ValidationError(r.problem);
  return r.change;
}

function record(adj: FindingAdjustment, decision: AdjustmentDecisionKind, actor: Actor, reason?: string): void {
  const entry: AdjustmentDecision = { step: adj.status, decision, by: actor.userId, byName: actor.name, at: new Date().toISOString() };
  if (reason?.trim()) entry.reason = reason.trim();
  adj.decisions.push(entry);
  adj.updatedAt = entry.at;
}

function setChange(adj: FindingAdjustment, change: ResolvedChange, reason: string): void {
  adj.addedCases = change.addedCases;
  adj.amountChange = change.amountChange;
  adj.newCaseAmounts = change.newCaseAmounts;
  adj.caseAmountChanges = change.caseAmountChanges;
  adj.reason = reason.trim();
}

/** The stored change, as an input to re-validate against the finding as it is now. */
function inputOf(adj: FindingAdjustment): AdjustmentInput {
  return {
    addedCases: adj.addedCases,
    amountChange: adj.amountChange,
    newCaseAmounts: adj.newCaseAmounts,
    caseAmountChanges: adj.caseAmountChanges.map((c) => ({ caseId: c.caseId, to: c.to })),
    reason: adj.reason,
  };
}

function describe(adj: FindingAdjustment): string {
  const parts: string[] = [];
  if (adj.addedCases > 0) parts.push(`+${adj.addedCases} case${adj.addedCases === 1 ? "" : "s"}`);
  if (adj.amountChange !== 0) parts.push(`amount ${adj.amountChange > 0 ? "+" : ""}${adj.amountChange.toLocaleString("en-US")}`);
  return parts.join(", ") || "no change";
}

function audit(db: Database, actor: Actor, action: string, adj: FindingAdjustment, extra: { oldValue?: unknown; newValue?: unknown; reason?: string } = {}) {
  appendAuditLog(db, {
    userId: actor.userId,
    userName: actor.name,
    action,
    entityType: "Finding",
    entityId: adj.findingId,
    oldValue: extra.oldValue,
    newValue: extra.newValue ?? { adjustmentId: adj.id, status: adj.status, addedCases: adj.addedCases, amountChange: adj.amountChange },
    reason: extra.reason,
  });
}

/** Who acts on the adjustment at its current review step, notified when it arrives there. */
function notifyReviewers(db: Database, f: Finding, adj: FindingAdjustment): void {
  const opts = {
    type: "ADJUSTMENT_SUBMITTED" as const,
    title: `${f.reference}: adjustment awaiting your review`,
    message: `${adj.requestedByName} requested ${describe(adj)}. Reason: ${adj.reason}`,
    entityType: "Finding",
    entityId: f.id,
  };
  const exclude = (ids: string[]) => ids.filter((id) => id !== adj.requestedBy);
  if (adj.status === "DISTRICT_REVIEW") {
    notifyUsers(db, exclude(usersWithFindingsPermission(db, "district-review", { districtId: f.districtId, branchId: f.branchId })), opts);
  } else if (adj.status === "HO_REVIEW") {
    notifyUsers(db, exclude(usersWithFindingsPermission(db, "ho-review", { districtId: f.districtId, branchId: f.branchId })), opts);
  } else if (adj.status === "PENDING_BANK_APPROVAL") {
    notifyUsers(db, exclude(db.settings.hoApproval.approverUserIds), opts);
  }
}

/** Moves a draft / returned adjustment into its review path (or approves it at once - R11). */
function submitInto(db: Database, f: Finding, adj: FindingAdjustment, actor: Actor): void {
  const current = currentPeriod(db.reportingPeriods);
  if (!current || f.periodId !== current.id) {
    throw new BusinessRuleError("BUSINESS_RULE_VIOLATION", "Only a finding in the current period can be adjusted - transfer it there first");
  }
  rule(submitProblem(db, current.id));
  adj.periodId = current.id; // R16: reported in the period it was submitted in
  adj.submittedAt = new Date().toISOString();
  record(adj, "SUBMIT", actor);
  adj.status = firstStep(db, adj.requesterScope);
  audit(db, actor, "FINDING_ADJUSTMENT_SUBMITTED", adj);
  if (adj.status === "APPROVED") applyAdjustment(db, f, adj, actor);
  else notifyReviewers(db, f, adj);
}

// ---------------------------------------------------------------------------
// Requester actions

/** Starts an adjustment (R1, R2, R8, R14), as a draft or submitted at once. */
export function createAdjustment(
  db: Database,
  config: AdjustmentConfig,
  session: SessionData,
  findingId: string,
  input: AdjustmentInput,
  opts: { submit: boolean }
): FindingAdjustment {
  const actor = actorOf(session);
  const f = findingOf(db, findingId);
  rule(eligibilityProblem(db, config, session, f));
  const change = resolved(db, f, input);
  const now = new Date().toISOString();
  const adj: FindingAdjustment = {
    id: uuid(),
    findingId: f.id,
    periodId: f.periodId,
    status: "DRAFT",
    addedCases: 0,
    amountChange: 0,
    newCaseAmounts: [],
    caseAmountChanges: [],
    reason: "",
    requestedBy: actor.userId,
    requestedByName: actor.name,
    requesterScope: session.orgScope === "BANK" ? "BANK" : session.orgScope === "DISTRICT" ? "DISTRICT" : "BRANCH",
    submittedAt: null,
    approvedAt: null,
    decisions: [],
    applied: null,
    createdAt: now,
    updatedAt: now,
  };
  setChange(adj, change, input.reason);
  db.findingAdjustments.push(adj);
  audit(db, actor, "FINDING_ADJUSTMENT_CREATED", adj, { reason: adj.reason });
  if (opts.submit) submitInto(db, f, adj, actor);
  return adj;
}

/** Only the requester edits / submits / withdraws their adjustment. */
function assertRequester(session: SessionData, f: Finding, adj: FindingAdjustment): Actor {
  const actor = actorOf(session);
  if (adj.requestedBy !== actor.userId) throw new AuthorizationError("Only the user who requested this adjustment can change it");
  rule(requesterProblem(session, f));
  return actor;
}

/** Edits the change (R13): a draft, a returned one, or before any reviewer acted. Optionally submits it. */
export function editAdjustment(
  db: Database,
  config: AdjustmentConfig,
  session: SessionData,
  findingId: string,
  adjustmentId: string,
  input: AdjustmentInput,
  opts: { submit: boolean }
): FindingAdjustment {
  const f = findingOf(db, findingId);
  const adj = adjustmentOf(db, findingId, adjustmentId);
  const actor = assertRequester(session, f, adj);
  if (!isEditableByRequester(adj)) throw new BusinessRuleError("BUSINESS_RULE_VIOLATION", "A reviewer has already acted - this adjustment can no longer be edited");
  if (!isOutstanding(f)) throw new BusinessRuleError("BUSINESS_RULE_VIOLATION", "The finding is no longer outstanding - withdraw this adjustment");
  const before = { addedCases: adj.addedCases, amountChange: adj.amountChange, reason: adj.reason };
  setChange(adj, resolved(db, f, input), input.reason);
  const inReview = isReviewStep(adj.status);
  record(adj, "EDIT", actor);
  audit(db, actor, "FINDING_ADJUSTMENT_EDITED", adj, { oldValue: before });
  if (inReview) notifyReviewers(db, f, adj); // already in review: reviewers see the corrected figures
  else if (opts.submit) submitAdjustment(db, config, session, findingId, adjustmentId);
  return adj;
}

/** Submits a draft, or resubmits a returned adjustment. */
export function submitAdjustment(db: Database, config: AdjustmentConfig, session: SessionData, findingId: string, adjustmentId: string): FindingAdjustment {
  const f = findingOf(db, findingId);
  const adj = adjustmentOf(db, findingId, adjustmentId);
  const actor = assertRequester(session, f, adj);
  if (adj.status !== "DRAFT" && adj.status !== "RETURNED") throw new BusinessRuleError("BUSINESS_RULE_VIOLATION", "Only a draft or returned adjustment can be submitted");
  // R17: a draft never entered the approval path - a de-listed area stops it;
  // a returned one was already pending and may finish.
  if (adj.status === "DRAFT" && !isRevolvingArea(config, f.operationArea)) {
    throw new BusinessRuleError("BUSINESS_RULE_VIOLATION", `Adjustments are no longer enabled for "${f.operationArea}" - withdraw this draft`);
  }
  if (!isOutstanding(f)) throw new BusinessRuleError("BUSINESS_RULE_VIOLATION", "The finding is no longer outstanding - withdraw this adjustment");
  setChange(adj, resolved(db, f, inputOf(adj)), adj.reason); // re-checked against the finding as it is now
  submitInto(db, f, adj, actor);
  return adj;
}

/** Withdraws it (R13) - kept in the history. */
export function withdrawAdjustment(db: Database, session: SessionData, findingId: string, adjustmentId: string, reason?: string): FindingAdjustment {
  const adj = adjustmentOf(db, findingId, adjustmentId);
  const actor = actorOf(session);
  if (adj.requestedBy !== actor.userId) throw new AuthorizationError("Only the user who requested this adjustment can withdraw it");
  if (!isEditableByRequester(adj)) throw new BusinessRuleError("BUSINESS_RULE_VIOLATION", "A reviewer has already acted - this adjustment can no longer be withdrawn");
  record(adj, "WITHDRAW", actor, reason);
  adj.status = "WITHDRAWN";
  audit(db, actor, "FINDING_ADJUSTMENT_WITHDRAWN", adj, { reason });
  return adj;
}

/** Statuses whose adjustment can be deleted - never applied (an approved one is part of the finding's figures). */
export const DELETABLE_ADJUSTMENT_STATUSES: readonly AdjustmentStatus[] = ["REJECTED", "RETURNED", "WITHDRAWN"];

/** Who may delete it: the requester; a rejected one also anyone with Findings > Delete Rejected (housekeeping). */
export function canDeleteAdjustment(session: SessionData, adj: FindingAdjustment): boolean {
  if (!DELETABLE_ADJUSTMENT_STATUSES.includes(adj.status)) return false;
  if (adj.requestedBy === session.userId) return true;
  return adj.status === "REJECTED" && (session.permissions ?? []).includes("findings.delete-rejected");
}

/**
 * Deletes a rejected / returned / withdrawn adjustment. The audit log keeps
 * a full copy; a deleted returned one frees the finding for a new adjustment.
 */
export function deleteAdjustment(db: Database, session: SessionData, findingId: string, adjustmentId: string): FindingAdjustment {
  const actor = actorOf(session);
  const adj = adjustmentOf(db, findingId, adjustmentId);
  if (!DELETABLE_ADJUSTMENT_STATUSES.includes(adj.status)) {
    throw new BusinessRuleError("BUSINESS_RULE_VIOLATION", "Only a rejected, returned or withdrawn adjustment can be deleted");
  }
  if (!canDeleteAdjustment(session, adj)) throw new AuthorizationError("Only the requester (or, for a rejected one, Delete Rejected) can delete this adjustment");
  db.findingAdjustments = db.findingAdjustments.filter((a) => a.id !== adj.id);
  audit(db, actor, "FINDING_ADJUSTMENT_DELETED", adj, { oldValue: { ...adj }, newValue: { adjustmentId: adj.id, deleted: true } });
  return adj;
}

// ---------------------------------------------------------------------------
// Review

/** Approve / return / reject at the adjustment's current step (R11, R12). */
export function reviewAdjustment(
  db: Database,
  session: SessionData,
  findingId: string,
  adjustmentId: string,
  decision: ReviewDecision,
  reason?: string
): FindingAdjustment {
  const actor = actorOf(session);
  const f = findingOf(db, findingId);
  const adj = adjustmentOf(db, findingId, adjustmentId);
  rule(reviewerProblem(db, session, adj, f));
  if (decision !== "APPROVE" && (reason ?? "").trim().length < 5) {
    throw new ValidationError("A reason of at least 5 characters is required to return or reject an adjustment");
  }
  const step = adj.status;
  if (!isReviewStep(step)) throw new BusinessRuleError("BUSINESS_RULE_VIOLATION", "This adjustment isn't awaiting a review");

  if (decision === "APPROVE") {
    const next: AdjustmentStatus = nextStep(step);
    if (next === "APPROVED") {
      // R15: re-checked against the finding as it is now - fails here rather than applying a stale change.
      if (!isOutstanding(f)) throw new BusinessRuleError("BUSINESS_RULE_VIOLATION", "The finding is no longer outstanding - reject this adjustment");
      const r = resolveChange(db, f, inputOf(adj));
      if (!r.ok) throw new BusinessRuleError("BUSINESS_RULE_VIOLATION", `This adjustment no longer fits the finding (${r.problem}) - return or reject it`);
      setChange(adj, r.change, adj.reason);
    }
    record(adj, "APPROVE", actor, reason);
    adj.status = next;
    audit(db, actor, "FINDING_ADJUSTMENT_REVIEWED", adj, { reason });
    if (next === "APPROVED") applyAdjustment(db, f, adj, actor);
    else notifyReviewers(db, f, adj);
    return adj;
  }

  record(adj, decision, actor, reason);
  adj.status = decision === "RETURN" ? "RETURNED" : "REJECTED";
  audit(db, actor, decision === "RETURN" ? "FINDING_ADJUSTMENT_RETURNED" : "FINDING_ADJUSTMENT_REJECTED", adj, { reason });
  notifyUsers(db, [adj.requestedBy], {
    type: decision === "RETURN" ? "ADJUSTMENT_RETURNED" : "ADJUSTMENT_REJECTED",
    title: `${f.reference}: adjustment ${decision === "RETURN" ? "returned for correction" : "rejected"}`,
    message: `${actor.name}: ${reason?.trim() ?? ""}`,
    entityType: "Finding",
    entityId: f.id,
  });
  return adj;
}

// ---------------------------------------------------------------------------
// Apply (§3)

/** Applies an APPROVED adjustment to the finding's current figures - originals stay as they were. */
function applyAdjustment(db: Database, f: Finding, adj: FindingAdjustment, actor: Actor): void {
  const now = new Date().toISOString();
  const before = { caseCount: f.caseCount, amount: f.amount, status: f.status as string };
  const newCaseCount = f.caseCount + adj.addedCases;
  const newAmount = Math.round((f.amount + adj.amountChange) * 100) / 100;

  const addedCaseIds: string[] = [];
  const rows = caseRowsOf(db, f.id);
  if (rows.length > 0) {
    for (const ch of adj.caseAmountChanges) {
      const row = db.findingCases.find((c) => c.id === ch.caseId);
      if (row) row.amount = ch.to;
    }
    let seq = Math.max(...rows.map((c) => c.seq));
    const added: FindingCase[] = adj.newCaseAmounts.map((amount) => ({
      id: uuid(),
      findingId: f.id,
      seq: ++seq,
      amount,
      description: "Added by adjustment",
      status: "OUTSTANDING",
      createdAt: now,
    }));
    db.findingCases.push(...added);
    addedCaseIds.push(...added.map((c) => c.id));
  }

  f.caseCount = newCaseCount;
  f.amount = newAmount;
  const fromStatus = f.status;
  f.status = rectificationStatusAfter(f, newCaseCount, newAmount);
  f.updatedAt = now;

  adj.approvedAt = now;
  adj.applied = { before, after: { caseCount: f.caseCount, amount: f.amount, status: f.status }, addedCaseIds };
  adj.updatedAt = now;

  db.findingTransitions.unshift({
    id: uuid(),
    findingId: f.id,
    fromStatus,
    toStatus: f.status,
    action: "ADJUSTMENT_APPLIED",
    userId: actor.userId,
    userName: actor.name,
    reason: `${describe(adj)} - ${adj.reason}`,
    createdAt: now,
  });
  audit(db, actor, "FINDING_ADJUSTMENT_APPROVED", adj, { oldValue: before, newValue: { adjustmentId: adj.id, ...adj.applied.after }, reason: adj.reason });

  const message = `${describe(adj)}: now ${f.caseCount} case(s), ${f.amount.toLocaleString("en-US")} ${f.currency}. Reason: ${adj.reason}`;
  notifyFindingsPermissionHolders(db, "rectify", { branchId: f.branchId }, {
    type: "ADJUSTMENT_APPROVED",
    title: `${f.reference}: outstanding adjusted`,
    message,
    entityType: "Finding",
    entityId: f.id,
  });
  if (adj.requestedBy !== actor.userId) {
    notifyUsers(db, [adj.requestedBy], { type: "ADJUSTMENT_APPROVED", title: `${f.reference}: your adjustment was approved`, message, entityType: "Finding", entityId: f.id });
  }
}
