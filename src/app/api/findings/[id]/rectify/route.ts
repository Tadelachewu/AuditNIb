import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { assertFindingInScope } from "@/lib/findings-scope";
import { transitionFinding } from "@/lib/findings";
import type { FindingStatus, RectificationEntry } from "@/types";

const RECTIFIABLE_STATUSES = ["SENT_TO_BRANCH_MANAGER", "PARTIALLY_RECTIFIED"];

const rectifySchema = z.object({
  rectifiedCases: z.number().int().min(0),
  rectifiedAmount: z.number().min(0),
  note: z.string().optional(),
});

// Branch Manager's "Record corrective actions... Enter rectified case
// counts" (icfms.txt), also usable by the Branch Internal Controller
// ("Verify rectifications"). Cases and amount are validated independently
// against what's still outstanding - plan doc §3.5's own acceptance
// example (3 cases/45,000 -> 1 case/10,000 rectified, 2 cases/35,000
// outstanding) is exactly this rule.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("findings.rectify");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const parsed = rectifySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const input = parsed.data;
  if (input.rectifiedCases === 0 && input.rectifiedAmount === 0) {
    return NextResponse.json({ error: "Enter at least a rectified case count or amount" }, { status: 400 });
  }

  const db = readDb();
  const existing = db.findings.find((f) => f.id === id);
  if (!existing) return NextResponse.json({ error: "Finding not found" }, { status: 404 });

  const scopeError = assertFindingInScope(auth.session, existing);
  if (scopeError) return NextResponse.json({ error: scopeError }, { status: 403 });

  if (!RECTIFIABLE_STATUSES.includes(existing.status)) {
    return NextResponse.json({ error: "This finding isn't awaiting rectification" }, { status: 409 });
  }

  const outstandingCases = existing.caseCount - existing.rectifiedCases;
  const outstandingAmount = existing.amount - existing.rectifiedAmount;
  if (input.rectifiedCases > outstandingCases) {
    return NextResponse.json(
      { error: `Rectified cases (${input.rectifiedCases}) cannot exceed the outstanding ${outstandingCases}` },
      { status: 400 }
    );
  }
  if (input.rectifiedAmount > outstandingAmount) {
    return NextResponse.json(
      { error: `Rectified amount (${input.rectifiedAmount}) cannot exceed the outstanding ${outstandingAmount}` },
      { status: 400 }
    );
  }

  const updated = updateDb((current) => {
    const f = current.findings.find((x) => x.id === id)!;

    const entry: RectificationEntry = {
      id: uuid(),
      findingId: f.id,
      rectifiedCases: input.rectifiedCases,
      rectifiedAmount: input.rectifiedAmount,
      note: input.note,
      submittedBy: auth.session.userId!,
      submittedByName: auth.session.name!,
      createdAt: new Date().toISOString(),
    };
    current.rectifications.push(entry);

    f.rectifiedCases += input.rectifiedCases;
    f.rectifiedAmount += input.rectifiedAmount;

    const fullyRectified = f.rectifiedCases >= f.caseCount && f.rectifiedAmount >= f.amount;
    const toStatus: FindingStatus = fullyRectified ? "RECTIFIED" : "PARTIALLY_RECTIFIED";
    transitionFinding(current, f, { toStatus, action: "RECTIFY", userId: auth.session.userId!, userName: auth.session.name! });

    return f;
  });

  return NextResponse.json({ finding: updated });
}
