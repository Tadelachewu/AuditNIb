import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { assertFindingInScope } from "@/lib/findings-scope";
import { appendAuditLog } from "@/lib/audit";
import { notifyFindingsPermissionHolders } from "@/lib/notifications";

// The District Controller's gate on a Branch Manager's recorded
// rectification, before any of it is closable by anyone (including HO) -
// "what is missing after the manager rectified a finding... before it
// reached the HO, the district controller should have approve[d] that
// rectified case." Mirrors close/route.ts's own "verify whatever's
// currently outstanding at this stage, partial or full, at any time"
// pattern: this catches districtVerifiedCases/Amount up to whatever's
// currently rectifiedCases/Amount, not gated to a single "fully rectified"
// moment. The alternative to verifying is returning it for correction
// instead - see return-rectification/route.ts, now gated by this same
// findings.verify-rectification permission rather than findings.close.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("findings.verify-rectification");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const db = readDb();
  const existing = db.findings.find((f) => f.id === id);
  if (!existing) return NextResponse.json({ error: "Finding not found" }, { status: 404 });

  const scopeError = assertFindingInScope(auth.session, existing);
  if (scopeError) return NextResponse.json({ error: scopeError }, { status: 403 });

  if (existing.status === "RECTIFICATION_RETURNED" || existing.status === "CLOSED") {
    return NextResponse.json({ error: "This finding has no recorded rectification awaiting verification" }, { status: 409 });
  }
  const verifiableCases = existing.rectifiedCases - existing.districtVerifiedCases;
  const verifiableAmount = existing.rectifiedAmount - existing.districtVerifiedAmount;
  if (verifiableCases <= 0 && verifiableAmount <= 0) {
    return NextResponse.json({ error: "Nothing rectified is awaiting verification yet" }, { status: 409 });
  }

  const updated = updateDb((current) => {
    const f = current.findings.find((x) => x.id === id)!;

    f.districtVerifiedCases += verifiableCases;
    f.districtVerifiedAmount += verifiableAmount;
    f.updatedAt = new Date().toISOString();

    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "DISTRICT_VERIFY_RECTIFICATION",
      entityType: "Finding",
      entityId: f.id,
      newValue: { districtVerifiedCases: f.districtVerifiedCases, districtVerifiedAmount: f.districtVerifiedAmount },
    });

    notifyFindingsPermissionHolders(current, "close", { districtId: f.districtId }, {
      type: "RECTIFICATION_VERIFIED",
      title: `${f.reference} verified - ready to close`,
      message: `${auth.session.name} verified ${verifiableCases} case(s) / ${f.currency} ${verifiableAmount.toLocaleString()} of the recorded rectification.`,
      entityType: "Finding",
      entityId: f.id,
    });

    return f;
  });

  return NextResponse.json({ finding: updated });
}
