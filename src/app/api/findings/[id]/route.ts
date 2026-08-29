import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { assertFindingInScope } from "@/lib/findings-scope";
import { assertPeriodWritable, nextFindingReference } from "@/lib/findings";
import { isDepartmentInScope } from "@/lib/org";
import { appendAuditLog } from "@/lib/audit";

const EDITABLE_STATUSES = ["DRAFT", "RETURNED"];

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("findings.view");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const db = readDb();
  const finding = db.findings.find((f) => f.id === id);
  if (!finding) return NextResponse.json({ error: "Finding not found" }, { status: 404 });

  const scopeError = assertFindingInScope(auth.session, finding);
  if (scopeError) return NextResponse.json({ error: scopeError }, { status: 403 });

  const transitions = db.findingTransitions
    .filter((t) => t.findingId === id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const rectifications = db.rectifications
    .filter((r) => r.findingId === id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return NextResponse.json({ finding, transitions, rectifications });
}

// Every registration-form field except `reference` (always system-
// generated - see nextFindingReference()) and `status` (only ever changed
// via the workflow actions - submit/review/rectify/etc.) is editable while
// a finding is still DRAFT/RETURNED, i.e. before anyone downstream has
// acted on it. That includes the org/workflow-identity fields
// (source/department/period/district/branch), not just free-text content -
// changing branch or period regenerates `reference` to match (see below),
// same as if the finding had been created fresh under the new values.
const updateSchema = z.object({
  title: z.string().min(1).optional(),
  sourceId: z.string().min(1).optional(),
  departmentId: z.string().min(1).optional(),
  periodId: z.string().min(1).optional(),
  districtId: z.string().min(1).optional(),
  branchId: z.string().min(1).optional(),
  findingDate: z.string().min(1).optional(),
  operationArea: z.string().min(1).optional(),
  irregularityType: z.string().min(1).optional(),
  categoryId: z.string().min(1).optional(),
  amount: z.number().nonnegative().optional(),
  currency: z.string().min(1).optional(),
  caseCount: z.number().int().positive().optional(),
  riskLevel: z.string().min(1).optional(),
  priority: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  recommendation: z.string().optional(),
  rootCause: z.string().optional(),
  evidenceNote: z.string().optional(),
});

// Only DRAFT/RETURNED are editable (plan doc §3.3). Editing a RETURNED
// finding does not by itself resubmit it - that's the separate
// POST .../submit action, same as an initial DRAFT.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("findings.edit");
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const input = parsed.data;

  const db = readDb();
  const existing = db.findings.find((f) => f.id === id);
  if (!existing) return NextResponse.json({ error: "Finding not found" }, { status: 404 });

  const scopeError = assertFindingInScope(session, existing);
  if (scopeError) return NextResponse.json({ error: scopeError }, { status: 403 });

  if (!EDITABLE_STATUSES.includes(existing.status)) {
    return NextResponse.json({ error: "Only draft or returned findings can be edited" }, { status: 409 });
  }

  const periodError = assertPeriodWritable(db, existing.periodId);
  if (periodError) return NextResponse.json({ error: periodError }, { status: 409 });

  // Same org-scope rule POST /api/findings enforces at creation: a
  // branch-scoped session can never move its own finding to a different
  // branch/district, and a district-scoped session can never move it
  // outside their district.
  const districtId = input.districtId ?? existing.districtId;
  const branchId = input.branchId ?? existing.branchId;
  if (session.orgScope === "BRANCH" && (districtId !== existing.districtId || branchId !== existing.branchId)) {
    return NextResponse.json({ error: "You can only edit findings within your own branch" }, { status: 403 });
  }
  if (session.orgScope === "DISTRICT" && districtId !== session.districtId) {
    return NextResponse.json({ error: "Outside your organizational scope" }, { status: 403 });
  }

  const branch = db.branches.find((b) => b.id === branchId);
  if (!branch) return NextResponse.json({ error: "Selected branch does not exist" }, { status: 400 });
  if (branch.districtId !== districtId) {
    return NextResponse.json({ error: "Selected branch does not belong to the selected district" }, { status: 400 });
  }

  const periodId = input.periodId ?? existing.periodId;
  const period = db.reportingPeriods.find((p) => p.id === periodId);
  if (!period) return NextResponse.json({ error: "Selected reporting period does not exist" }, { status: 400 });
  if (period.status === "LOCKED") {
    return NextResponse.json({ error: `${period.code} is locked and cannot accept changes` }, { status: 409 });
  }

  const sourceId = input.sourceId ?? existing.sourceId;
  if (!db.sources.some((s) => s.id === sourceId && s.active)) {
    return NextResponse.json({ error: "Selected source is not active" }, { status: 400 });
  }
  const departmentId = input.departmentId ?? existing.departmentId;
  const department = db.departments.find((d) => d.id === departmentId && d.active);
  if (!department) {
    return NextResponse.json({ error: "Selected department is not active" }, { status: 400 });
  }
  if (!isDepartmentInScope(department, { districtId, branchId })) {
    return NextResponse.json({ error: "Selected department is not available for this district/branch" }, { status: 400 });
  }
  const categoryId = input.categoryId ?? existing.categoryId;
  if (!db.categories.some((c) => c.id === categoryId && c.active)) {
    return NextResponse.json({ error: "Selected classified case is not active" }, { status: 400 });
  }

  // Document_3 §12/§34's per-case itemization (FindingCase) sums to
  // caseCount/amount by construction at creation time - there's no UI yet
  // to re-itemize on edit, so changing either total out from under an
  // already-itemized finding would leave stale case rows that no longer
  // add up. Blocked rather than silently dropping the itemization.
  const hasItemizedCases = db.findingCases.some((fc) => fc.findingId === id);
  if (hasItemizedCases) {
    const newCaseCount = input.caseCount ?? existing.caseCount;
    const newAmount = input.amount ?? existing.amount;
    if (newCaseCount !== existing.caseCount || Math.abs(newAmount - existing.amount) > 0.01) {
      return NextResponse.json(
        { error: "This finding's cases are itemized - case count/amount can't be changed here without updating the case breakdown" },
        { status: 409 }
      );
    }
  }

  const referenceNeedsRegeneration = branchId !== existing.branchId || periodId !== existing.periodId;

  const before = { ...existing };
  const updated = updateDb((current) => {
    const f = current.findings.find((x) => x.id === id)!;
    Object.assign(f, input, { districtId, branchId, periodId, sourceId, departmentId, categoryId });
    if (referenceNeedsRegeneration) {
      // Re-derived from the *other* findings already in `current` at this
      // point (this record's old reference isn't in that count, since
      // it's about to be overwritten) - same sequencing guarantee
      // nextFindingReference() gives a brand-new finding.
      f.reference = nextFindingReference(current, branch, period);
    }
    f.updatedAt = new Date().toISOString();
    appendAuditLog(current, {
      userId: session.userId!,
      userName: session.name!,
      action: "UPDATE",
      entityType: "Finding",
      entityId: f.id,
      oldValue: before,
      newValue: f,
    });
    return f;
  });

  return NextResponse.json({ finding: updated });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("findings.delete");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const db = readDb();
  const existing = db.findings.find((f) => f.id === id);
  if (!existing) return NextResponse.json({ error: "Finding not found" }, { status: 404 });

  const scopeError = assertFindingInScope(auth.session, existing);
  if (scopeError) return NextResponse.json({ error: scopeError }, { status: 403 });

  if (existing.status !== "DRAFT") {
    return NextResponse.json({ error: "Only draft findings can be deleted" }, { status: 409 });
  }

  const periodError = assertPeriodWritable(db, existing.periodId);
  if (periodError) return NextResponse.json({ error: periodError }, { status: 409 });

  updateDb((current) => {
    current.findings = current.findings.filter((f) => f.id !== id);
    current.findingTransitions = current.findingTransitions.filter((t) => t.findingId !== id);
    current.findingCases = current.findingCases.filter((c) => c.findingId !== id);
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "DELETE",
      entityType: "Finding",
      entityId: id,
      oldValue: existing,
    });
  });

  return NextResponse.json({ ok: true });
}
