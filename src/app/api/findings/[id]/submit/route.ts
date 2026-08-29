import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { assertFindingInScope } from "@/lib/findings-scope";
import { submitFinding, assertPeriodWritable } from "@/lib/findings";
import { notifyFindingsPermissionHolders } from "@/lib/notifications";

const SUBMITTABLE_STATUSES = ["DRAFT", "RETURNED"];

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("findings.submit");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const db = readDb();
  const existing = db.findings.find((f) => f.id === id);
  if (!existing) return NextResponse.json({ error: "Finding not found" }, { status: 404 });

  const scopeError = assertFindingInScope(auth.session, existing);
  if (scopeError) return NextResponse.json({ error: scopeError }, { status: 403 });

  if (!SUBMITTABLE_STATUSES.includes(existing.status)) {
    return NextResponse.json({ error: "Only draft or returned findings can be submitted" }, { status: 409 });
  }

  const periodError = assertPeriodWritable(db, existing.periodId);
  if (periodError) return NextResponse.json({ error: periodError }, { status: 409 });

  const updated = updateDb((current) => {
    const f = current.findings.find((x) => x.id === id)!;
    submitFinding(current, f, auth.session.userId!, auth.session.name!);
    notifyFindingsPermissionHolders(current, "district-review", { districtId: f.districtId }, {
      type: "SUBMITTED",
      title: `${f.reference} awaiting district review`,
      message: `${auth.session.name} submitted this finding for district review.`,
      entityType: "Finding",
      entityId: f.id,
    });
    return f;
  });

  return NextResponse.json({ finding: updated });
}
