import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { findingsInScope } from "@/lib/findings-scope";
import { nextFindingReference, submitFinding } from "@/lib/findings";
import type { Finding } from "@/types";

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
  sourceId: z.string().min(1, "Source is required"),
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
  description: z.string().min(1, "Description is required"),
  recommendation: z.string().optional(),
  evidenceNote: z.string().optional(),
  submit: z.boolean().default(false),
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
  if (!db.categories.some((c) => c.id === input.categoryId && c.active)) {
    return NextResponse.json({ error: "Selected classified case is not active" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const finding: Finding = {
    id: uuid(),
    reference: nextFindingReference(db, branch, period),
    sourceId: input.sourceId,
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
    description: input.description,
    recommendation: input.recommendation,
    evidenceNote: input.evidenceNote,
    status: "DRAFT",
    rectifiedCases: 0,
    rectifiedAmount: 0,
    createdBy: session.userId!,
    createdAt: now,
    updatedAt: now,
  };

  updateDb((current) => {
    current.findings.push(finding);
    if (input.submit) {
      // Re-resolve the pushed record from `current` (not the outer
      // `finding` closure) so submitFinding mutates the copy that's
      // actually persisted by updateDb().
      const persisted = current.findings.find((f) => f.id === finding.id)!;
      submitFinding(current, persisted, session.userId!, session.name!);
    }
  });

  const created = readDb().findings.find((f) => f.id === finding.id)!;
  return NextResponse.json({ finding: created }, { status: 201 });
}
