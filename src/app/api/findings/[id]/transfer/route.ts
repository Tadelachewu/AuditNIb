import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { assertFindingInScope } from "@/lib/findings-scope";
import { transferFinding } from "@/lib/findings";
import { notifyUsers, usersWithFindingsPermission } from "@/lib/notifications";

// A finding is only ever "outstanding" (has a balance a transfer would
// move) in these three statuses - see findings.ts's transferFinding()
// doc comment for why this doesn't touch the source period's lock.
const TRANSFERABLE_STATUSES = ["SENT_TO_BRANCH_MANAGER", "PARTIALLY_RECTIFIED", "TRANSFERRED"];

const transferSchema = z.object({
  toPeriodId: z.string().min(1),
  reason: z.string().min(1, "A reason is required"),
});

// icfms.txt / master.txt §8: "Transfer outstanding cases to the next
// reporting period" - District Controller's action (see db.ts's
// districtControllerPermissions). Deliberately skips assertPeriodWritable()
// on the *source* period: transfer is the intended path once a period
// locks with the finding still outstanding.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("findings.transfer");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const parsed = transferSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const input = parsed.data;

  const db = readDb();
  const existing = db.findings.find((f) => f.id === id);
  if (!existing) return NextResponse.json({ error: "Finding not found" }, { status: 404 });

  const scopeError = assertFindingInScope(auth.session, existing);
  if (scopeError) return NextResponse.json({ error: scopeError }, { status: 403 });

  if (!TRANSFERABLE_STATUSES.includes(existing.status)) {
    return NextResponse.json({ error: "This finding has no outstanding balance to transfer" }, { status: 409 });
  }

  if (input.toPeriodId === existing.periodId) {
    return NextResponse.json({ error: "Destination period must differ from the current period" }, { status: 400 });
  }
  const destination = db.reportingPeriods.find((p) => p.id === input.toPeriodId);
  if (!destination) return NextResponse.json({ error: "Destination period not found" }, { status: 404 });
  if (destination.status !== "OPEN") {
    return NextResponse.json({ error: "Destination period must be open" }, { status: 409 });
  }

  const updated = updateDb((current) => {
    const f = current.findings.find((x) => x.id === id)!;

    transferFinding(current, f, {
      toPeriodId: input.toPeriodId,
      reason: input.reason,
      userId: auth.session.userId!,
      userName: auth.session.name!,
    });

    const recipients = new Set([
      f.createdBy,
      ...usersWithFindingsPermission(current, "transfer", { districtId: f.districtId }),
    ]);
    notifyUsers(current, [...recipients], {
      type: "TRANSFERRED",
      title: `${f.reference} transferred to ${destination.code}`,
      message: `${auth.session.name} moved the outstanding balance to ${destination.code}: ${input.reason}`,
      entityType: "Finding",
      entityId: f.id,
    });

    return f;
  });

  return NextResponse.json({ finding: updated });
}
