import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { assertFindingInScope } from "@/lib/findings-scope";
import { transitionFinding } from "@/lib/findings";

// District/HO Controller's verification duty (plan doc §3.6): closure is
// deliberately not self-service by the Branch Manager who recorded the
// rectification - only reachable from RECTIFIED.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("findings.close");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const db = readDb();
  const existing = db.findings.find((f) => f.id === id);
  if (!existing) return NextResponse.json({ error: "Finding not found" }, { status: 404 });

  const scopeError = assertFindingInScope(auth.session, existing);
  if (scopeError) return NextResponse.json({ error: scopeError }, { status: 403 });

  if (existing.status !== "RECTIFIED") {
    return NextResponse.json({ error: "Only fully rectified findings can be closed" }, { status: 409 });
  }

  const updated = updateDb((current) => {
    const f = current.findings.find((x) => x.id === id)!;
    transitionFinding(current, f, {
      toStatus: "CLOSED",
      action: "CLOSE",
      userId: auth.session.userId!,
      userName: auth.session.name!,
    });
    return f;
  });

  return NextResponse.json({ finding: updated });
}
