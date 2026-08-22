import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { requirePermission, requireUser } from "@/lib/guard";
import { hasPermission } from "@/lib/permissions/registry";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";

export async function GET() {
  const auth = await requirePermission("scoring-rules.view");
  if (!auth.ok) return auth.response;
  const rules = [...readDb().scoringRules].sort((a, b) => b.version - a.version);
  return NextResponse.json({ scoringRules: rules });
}

const createSchema = z.object({
  name: z.string().min(1, "Name is required"),
  effectiveFrom: z.string().min(1, "Effective date is required"),
  categories: z.array(z.string()).min(1, "Select at least one category"),
  sources: z.array(z.string()).min(1, "Select at least one source"),
  basis: z.string().min(1, "Calculation basis is required"),
  formulaType: z.string().min(1, "Formula type is required"),
  activateNow: z.boolean().default(false),
});

// Scoring rules are policy: this only ever creates a new version, it never
// mutates an existing one, so past periods keep reconciling against the
// rule that was actually active when they ran (see [id]/route.ts for
// activation, which is the only allowed mutation).
export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { activateNow, ...input } = parsed.data;

  // Creating a version needs "create"; asking for it to go live immediately
  // additionally needs "activate" - two separate action-level permissions,
  // even though they're expressed in one request when activateNow is set.
  if (!hasPermission(auth.session.permissions, "scoring-rules.create")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (activateNow && !hasPermission(auth.session.permissions, "scoring-rules.activate")) {
    return NextResponse.json({ error: "You can create a scoring rule but not activate it" }, { status: 403 });
  }

  const db = readDb();
  const nextVersion = db.scoringRules.reduce((max, r) => Math.max(max, r.version), 0) + 1;
  const now = new Date().toISOString();

  const rule = {
    id: uuid(),
    version: nextVersion,
    name: input.name,
    active: activateNow,
    effectiveFrom: input.effectiveFrom,
    categories: input.categories,
    sources: input.sources,
    basis: input.basis,
    formulaType: input.formulaType,
    createdBy: auth.session.userId!,
    createdAt: now,
  };

  updateDb((current) => {
    if (activateNow) {
      current.scoringRules.forEach((r) => (r.active = false));
    }
    current.scoringRules.push(rule);
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "CREATE",
      entityType: "ScoringRule",
      entityId: rule.id,
      newValue: rule,
    });
  });

  return NextResponse.json({ scoringRule: rule }, { status: 201 });
}
