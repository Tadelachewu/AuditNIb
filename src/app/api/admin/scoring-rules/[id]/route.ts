import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";

const activateSchema = z.object({
  active: z.boolean(),
});

// Only ever applies to a version that has never gone live
// (ScoringRule.everActivated) - once a rule has been active even once,
// historical periods may already reconcile against it, so master.txt §22's
// "never mutates an existing [live] version" rule (the same reasoning
// POST .../scoring-rules relies on for versioning) extends here: a
// still-in-draft version can be corrected freely, a version that ever
// went live can only be superseded by a new one, never rewritten.
const editSchema = z.object({
  name: z.string().min(1).optional(),
  effectiveFrom: z.string().min(1).optional(),
  categories: z.array(z.string()).min(1).optional(),
  sources: z.array(z.string()).min(1).optional(),
  basis: z.string().min(1).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);

  const db = readDb();
  const existing = db.scoringRules.find((r) => r.id === id);
  if (!existing) return NextResponse.json({ error: "Scoring rule not found" }, { status: 404 });

  // Activating/deactivating and editing fields are distinct actions with
  // distinct permissions - which this request is doing is inferred from
  // which keys the body actually sends, same pattern as
  // requireToggleOrEditPermission() elsewhere in admin/.
  if (body && typeof body === "object" && "active" in body) {
    const auth = await requirePermission("scoring-rules.activate");
    if (!auth.ok) return auth.response;

    const parsed = activateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
    }

    const updated = updateDb((current) => {
      if (parsed.data.active) {
        current.scoringRules.forEach((r) => {
          r.active = r.id === id;
          if (r.id === id) r.everActivated = true;
        });
      } else {
        const r = current.scoringRules.find((x) => x.id === id)!;
        r.active = false;
      }
      appendAuditLog(current, {
        userId: auth.session.userId!,
        userName: auth.session.name!,
        action: parsed.data.active ? "ACTIVATE" : "DEACTIVATE",
        entityType: "ScoringRule",
        entityId: id,
        oldValue: { active: existing.active },
        newValue: { active: parsed.data.active },
      });
      return current.scoringRules.find((x) => x.id === id)!;
    });

    return NextResponse.json({ scoringRule: updated });
  }

  const auth = await requirePermission("scoring-rules.edit");
  if (!auth.ok) return auth.response;

  const parsed = editSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  if (existing.everActivated) {
    return NextResponse.json(
      { error: "This version has gone live at some point and can no longer be edited - create a new version instead" },
      { status: 409 }
    );
  }
  if (parsed.data.categories) {
    const invalid = parsed.data.categories.find((cid) => !db.categories.some((c) => c.id === cid));
    if (invalid) return NextResponse.json({ error: `Unknown category "${invalid}"` }, { status: 400 });
  }
  if (parsed.data.sources) {
    const invalid = parsed.data.sources.find((sid) => !db.sources.some((s) => s.id === sid));
    if (invalid) return NextResponse.json({ error: `Unknown source "${invalid}"` }, { status: 400 });
  }

  const before = { ...existing };
  const updated = updateDb((current) => {
    const r = current.scoringRules.find((x) => x.id === id)!;
    Object.assign(r, parsed.data);
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "UPDATE",
      entityType: "ScoringRule",
      entityId: id,
      oldValue: before,
      newValue: r,
    });
    return r;
  });

  return NextResponse.json({ scoringRule: updated });
}

// Only a version that has never gone live can be deleted, for the same
// reason it can't be edited - see editSchema's comment above.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("scoring-rules.delete");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const db = readDb();
  const existing = db.scoringRules.find((r) => r.id === id);
  if (!existing) return NextResponse.json({ error: "Scoring rule not found" }, { status: 404 });
  if (existing.everActivated) {
    return NextResponse.json(
      { error: "This version has gone live at some point and can no longer be deleted" },
      { status: 409 }
    );
  }

  updateDb((current) => {
    current.scoringRules = current.scoringRules.filter((r) => r.id !== id);
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "DELETE",
      entityType: "ScoringRule",
      entityId: id,
      oldValue: existing,
    });
  });

  return NextResponse.json({ ok: true });
}
