import { NextResponse } from "next/server";
import { z } from "zod";
import { zEntityName } from "@/lib/inputRules";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";
import { withApiHandler } from "@/lib/api/handler";

const activateSchema = z.object({
  active: z.boolean(),
});

// Any version can be edited, including the active one or one that was active
// before. Performance % is always calculated live from the active rule, so
// editing the active rule changes every period's figures straight away; the
// audit log keeps the full before / after.
const editSchema = z.object({
  name: zEntityName().optional(),
  effectiveFrom: z.string().min(1).optional(),
  categories: z.array(z.string()).min(1).optional(),
  sources: z.array(z.string()).min(1).optional(),
  basis: z.string().min(1).optional(),
});

async function handlePATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);

  const db = await readDb();
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

    const updated = await updateDb((current) => {
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
  if (parsed.data.categories) {
    const invalid = parsed.data.categories.find((cid) => !db.categories.some((c) => c.id === cid));
    if (invalid) return NextResponse.json({ error: `Unknown category "${invalid}"` }, { status: 400 });
  }
  if (parsed.data.sources) {
    const invalid = parsed.data.sources.find((sid) => !db.sources.some((s) => s.id === sid));
    if (invalid) return NextResponse.json({ error: `Unknown source "${invalid}"` }, { status: 400 });
  }

  const before = { ...existing };
  const updated = await updateDb((current) => {
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

// Any version can be deleted except the ACTIVE one - deleting it would leave
// the system with no scoring rule (no Performance % anywhere). Activate
// another version (or deactivate this one) first. The audit log keeps the
// deleted version.
async function handleDELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("scoring-rules.delete");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const db = await readDb();
  const existing = db.scoringRules.find((r) => r.id === id);
  if (!existing) return NextResponse.json({ error: "Scoring rule not found" }, { status: 404 });
  if (existing.active) {
    return NextResponse.json(
      { error: "This is the active scoring rule - activate another version (or deactivate this one) before deleting it" },
      { status: 409 }
    );
  }

  await updateDb((current) => {
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

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const PATCH = withApiHandler(handlePATCH);
export const DELETE = withApiHandler(handleDELETE);
