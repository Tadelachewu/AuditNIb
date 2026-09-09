import { NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";
import { isDevResetEnabled, resetRegisteredData } from "@/lib/devResetRegisteredData";

// DEV-ONLY - see devResetRegisteredData.ts's own doc comment for the full
// picture (scope, isolation, how to remove this feature entirely). 404s
// outright whenever NODE_ENV=production, independent of the admin page's
// own gating and regardless of who calls it or how - this is the one check
// that actually matters, everything else here is defense in depth on top
// of it. Requires the literal ADMIN role (not just some permission a custom
// role happens to hold), since this is far more destructive than anything
// else the permission system gates.
const FORBIDDEN = () => NextResponse.json({ error: "Not found" }, { status: 404 });

async function requireDevAdmin() {
  if (!isDevResetEnabled()) return { ok: false as const, response: FORBIDDEN() };
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (auth.session.role !== "ADMIN") {
    return { ok: false as const, response: NextResponse.json({ error: "Administrator only" }, { status: 403 }) };
  }
  return auth;
}

// Lets the confirmation page show real counts ("this will delete 42
// findings...") before the admin commits to typing the confirmation phrase.
export async function GET() {
  const auth = await requireDevAdmin();
  if (!auth.ok) return auth.response;

  const db = readDb();
  return NextResponse.json({
    counts: {
      findings: db.findings.length,
      findingTransitions: db.findingTransitions.length,
      rectifications: db.rectifications.length,
      findingTransfers: db.findingTransfers.length,
      findingClosures: db.findingClosures.length,
      findingCases: db.findingCases.length,
      importBatches: db.importBatches.length,
      scoringAdjustments: db.scoringAdjustments.length,
      branchCoverageNotes: db.branchCoverageNotes.length,
      evidence: db.evidence.length,
      comments: db.comments.length,
    },
  });
}

const CONFIRM_PHRASE = "DELETE ALL FINDINGS";

export async function POST(request: Request) {
  const auth = await requireDevAdmin();
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  if (body?.confirm !== CONFIRM_PHRASE) {
    return NextResponse.json({ error: `Type "${CONFIRM_PHRASE}" exactly to confirm` }, { status: 400 });
  }

  const summary = updateDb((current) => {
    const result = resetRegisteredData(current);
    // The one log entry left standing that a reset ever happened - every
    // Finding-entityType entry was just dropped by the reset itself, but
    // this is about system administration, not a Finding, so it's exempt.
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "DEV_RESET_REGISTERED_DATA",
      entityType: "Settings",
      entityId: "dev-reset",
      newValue: result,
    });
    return result;
  });

  return NextResponse.json({ summary });
}
