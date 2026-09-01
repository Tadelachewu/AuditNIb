import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { findingsInScope } from "@/lib/findings-scope";
import { nextFindingReference, submitFinding } from "@/lib/findings";
import { isDepartmentInScope } from "@/lib/org";
import type { Finding, FindingCase } from "@/types";

export async function GET(request: Request) {
  const auth = await requirePermission("findings.view");
  if (!auth.ok) return auth.response;

  const db = readDb();
  let findings = findingsInScope(db, auth.session);

  // Query filters only ever narrow the scoped set above - never widen it -
  // matching the FilterBar's own "org fields are locked, not editable"
  // principle (see src/components/dashboard/FilterBar.tsx).
  const url = new URL(request.url);
  const periodId = url.searchParams.get("periodId");
  const districtId = url.searchParams.get("districtId");
  const branchId = url.searchParams.get("branchId");
  const sourceId = url.searchParams.get("sourceId");
  const categoryId = url.searchParams.get("categoryId");
  const risk = url.searchParams.get("risk");
  const status = url.searchParams.get("status");

  if (periodId) findings = findings.filter((f) => f.periodId === periodId);
  if (districtId) findings = findings.filter((f) => f.districtId === districtId);
  if (branchId) findings = findings.filter((f) => f.branchId === branchId);
  if (sourceId) findings = findings.filter((f) => f.sourceId === sourceId);
  if (categoryId) findings = findings.filter((f) => f.categoryId === categoryId);
  if (risk) findings = findings.filter((f) => f.riskLevel === risk);
  if (status) findings = findings.filter((f) => f.status === status);

  findings = [...findings].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return NextResponse.json({ findings });
}

const createSchema = z.object({
  title: z.string().min(1, "Finding title is required"),
  sourceId: z.string().min(1, "Source is required"),
  departmentId: z.string().min(1, "Department is required"),
  periodId: z.string().min(1, "Reporting period is required"),
  districtId: z.string().optional(),
  branchId: z.string().optional(),
  findingDate: z.string().min(1, "Finding date is required"),
  operationArea: z.string().min(1, "Operation area is required"),
  irregularityType: z.string().min(1, "Type of irregularity is required"),
  categoryId: z.string().min(1, "Classified case is required"),
  amount: z.number().nonnegative(),
  currency: z.string().min(1, "Currency is required"),
  caseCount: z.number().int().positive("Number of cases must be at least 1"),
  riskLevel: z.string().min(1, "Risk level is required"),
  priority: z.string().min(1, "Priority is required"),
  description: z.string().min(1, "Description is required"),
  recommendation: z.string().optional(),
  rootCause: z.string().optional(),
  evidenceNote: z.string().optional(),
  submit: z.boolean().default(false),
  // Document_3 §12/§34: optional case-level itemization, one amount per
  // case ("Case 1: 15,000, Case 2: 10,000, Case 3: 20,000" instead of just
  // "3 cases / 45,000 total"). When provided, must have exactly caseCount
  // entries summing to amount - validated below, not just by the schema,
  // since it's a cross-field rule.
  caseAmounts: z.array(z.number().nonnegative()).max(500).optional(),
});

// Branch-scoped roles (Branch Internal Controller registering their own
// findings) always get their own branch/district forced, the same way
// resolveOrgAssignment forces org fields elsewhere. Bank-wide roles (HO
// Controller registering Internal Audit findings - icfms.txt: "Register
// Internal Audit findings received from the Internal Audit Department")
// must supply which district/branch the finding concerns.
export async function POST(request: Request) {
  const auth = await requirePermission("findings.create");
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const input = parsed.data;

  const db = readDb();

  let districtId: string;
  let branchId: string;
  if (session.orgScope === "BRANCH") {
    if (!session.branchId || !session.districtId) {
      return NextResponse.json({ error: "Your account isn't assigned to an active branch" }, { status: 400 });
    }
    districtId = session.districtId;
    branchId = session.branchId;
  } else {
    if (!input.districtId || !input.branchId) {
      return NextResponse.json({ error: "District and branch are required" }, { status: 400 });
    }
    const branch = db.branches.find((b) => b.id === input.branchId);
    if (!branch) return NextResponse.json({ error: "Selected branch does not exist" }, { status: 400 });
    if (branch.districtId !== input.districtId) {
      return NextResponse.json({ error: "Selected branch does not belong to the selected district" }, { status: 400 });
    }
    if (session.orgScope === "DISTRICT" && input.districtId !== session.districtId) {
      return NextResponse.json({ error: "Outside your organizational scope" }, { status: 403 });
    }
    districtId = input.districtId;
    branchId = input.branchId;
  }

  const branch = db.branches.find((b) => b.id === branchId)!;
  const period = db.reportingPeriods.find((p) => p.id === input.periodId);
  if (!period) return NextResponse.json({ error: "Selected reporting period does not exist" }, { status: 400 });
  if (period.status === "LOCKED") {
    return NextResponse.json({ error: `${period.code} is locked and cannot accept new findings` }, { status: 409 });
  }
  if (!db.sources.some((s) => s.id === input.sourceId && s.active)) {
    return NextResponse.json({ error: "Selected source is not active" }, { status: 400 });
  }
  const department = db.departments.find((d) => d.id === input.departmentId && d.active);
  if (!department) {
    return NextResponse.json({ error: "Selected department is not active" }, { status: 400 });
  }
  // Same scope check the client applies to narrow its dropdown
  // (NewFindingForm.tsx's departmentOptions), re-verified server-side
  // since the client's filtering is only ever a convenience.
  if (!isDepartmentInScope(department, { districtId, branchId })) {
    return NextResponse.json({ error: "Selected department is not available for this district/branch" }, { status: 400 });
  }
  if (!db.categories.some((c) => c.id === input.categoryId && c.active)) {
    return NextResponse.json({ error: "Selected classified case is not active" }, { status: 400 });
  }
  if (input.caseAmounts) {
    if (input.caseAmounts.length !== input.caseCount) {
      return NextResponse.json(
        { error: `Case breakdown has ${input.caseAmounts.length} entries but the case count is ${input.caseCount}` },
        { status: 400 }
      );
    }
    const sum = input.caseAmounts.reduce((s, a) => s + a, 0);
    if (Math.abs(sum - input.amount) > 0.01) {
      return NextResponse.json(
        { error: `Case breakdown totals ${sum.toLocaleString()} but the amount involved is ${input.amount.toLocaleString()}` },
        { status: 400 }
      );
    }
  }

  const now = new Date().toISOString();
  const finding: Finding = {
    id: uuid(),
    reference: nextFindingReference(db, branch, period),
    title: input.title,
    sourceId: input.sourceId,
    departmentId: input.departmentId,
    periodId: input.periodId,
    districtId,
    branchId,
    findingDate: input.findingDate,
    operationArea: input.operationArea,
    irregularityType: input.irregularityType,
    categoryId: input.categoryId,
    amount: input.amount,
    currency: input.currency,
    caseCount: input.caseCount,
    riskLevel: input.riskLevel,
    priority: input.priority,
    description: input.description,
    recommendation: input.recommendation,
    rootCause: input.rootCause,
    evidenceNote: input.evidenceNote,
    status: "DRAFT",
    rectifiedCases: 0,
    rectifiedAmount: 0,
    closedCases: 0,
    closedAmount: 0,
    districtVerifiedCases: 0,
    districtVerifiedAmount: 0,
    createdBy: session.userId!,
    createdAt: now,
    updatedAt: now,
  };

  updateDb((current) => {
    current.findings.push(finding);
    if (input.caseAmounts) {
      const cases: FindingCase[] = input.caseAmounts.map((amount, i) => ({
        id: uuid(),
        findingId: finding.id,
        seq: i + 1,
        amount,
        status: "OUTSTANDING",
        createdAt: now,
      }));
      current.findingCases.push(...cases);
    }
    if (input.submit) {
      // Re-resolve the pushed record from `current` (not the outer
      // `finding` closure) so submitFinding mutates the copy that's
      // actually persisted by updateDb().
      const persisted = current.findings.find((f) => f.id === finding.id)!;
      submitFinding(current, persisted, session.userId!, session.name!, { registeredByBankScope: session.orgScope === "BANK" });
    }
  });

  const created = readDb().findings.find((f) => f.id === finding.id)!;
  return NextResponse.json({ finding: created }, { status: 201 });
}
