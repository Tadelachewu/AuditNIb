import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { assertFindingInScope } from "@/lib/findings-scope";
import { transitionFinding, hoApproveFinding } from "@/lib/findings";

const reviewSchema = z
  .object({
    decision: z.enum(["APPROVE", "REJECT", "RETURN"]),
    reason: z.string().optional(),
  })
  .refine((v) => v.decision === "APPROVE" || (v.reason && v.reason.trim().length >= 5), {
    message: "A reason of at least 5 characters is required to reject or return a finding",
    path: ["reason"],
  });

// Head Office Internal Controller's second-approval stage. Only acts on
// findings currently in HO_REVIEW; HO's orgScope is BANK-wide, so
// assertFindingInScope allows any district/branch here by design.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("findings.ho-review");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const parsed = reviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { decision, reason } = parsed.data;

  const db = readDb();
  const existing = db.findings.find((f) => f.id === id);
  if (!existing) return NextResponse.json({ error: "Finding not found" }, { status: 404 });

  const scopeError = assertFindingInScope(auth.session, existing);
  if (scopeError) return NextResponse.json({ error: scopeError }, { status: 403 });

  if (existing.status !== "HO_REVIEW") {
    return NextResponse.json({ error: "This finding is not awaiting HO review" }, { status: 409 });
  }

  const updated = updateDb((current) => {
    const f = current.findings.find((x) => x.id === id)!;
    if (decision === "APPROVE") {
      hoApproveFinding(current, f, auth.session.userId!, auth.session.name!);
    } else {
      transitionFinding(current, f, {
        toStatus: decision === "REJECT" ? "REJECTED" : "RETURNED",
        action: decision === "REJECT" ? "HO_REJECT" : "HO_RETURN",
        userId: auth.session.userId!,
        userName: auth.session.name!,
        reason,
      });
    }
    return f;
  });

  return NextResponse.json({ finding: updated });
}
