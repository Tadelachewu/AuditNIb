import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { zCode, zEntityName } from "@/lib/inputRules";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";
import { withApiHandler } from "@/lib/api/handler";
import { listPageJson } from "@/lib/serverList";

async function handleGET(request: Request) {
  const auth = await requirePermission("categories.view");
  if (!auth.ok) return auth.response;
  const db = await readDb();
  // Alphabetical by name ("Classified Case" in the FilterBar/finding form)
  // - same convention as /api/admin/branches/districts.
  // `scored` = counted toward performance: the category is in the active
  // scoring rule (Administration -> Scoring Rules). Worked out here, never
  // stored, so it always matches what the performance figures actually use.
  const scoredIds = new Set(db.scoringRules.find((r) => r.active)?.categories ?? []);
  const categories = [...db.categories]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ ...c, scored: scoredIds.has(c.id) }));
  // ?page=... -> one page of the Categories table (searched / filtered / sorted on the server).
  const paged = listPageJson(request, "categories", categories, {
    fields: {
      code: (c) => c.code,
      name: (c) => c.name,
      scored: (c) => (c.scored ? "Scored" : "Not scored"),
      status: (c) => (c.active ? "Active" : "Inactive"),
    },
    exact: ["scored", "status"],
  });
  if (paged) return NextResponse.json(paged);

  return NextResponse.json({ categories });
}

const createSchema = z.object({
  code: zCode(),
  name: zEntityName(),
});

async function handlePOST(request: Request) {
  const auth = await requirePermission("categories.create");
  if (!auth.ok) return auth.response;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const db = await readDb();
  if (db.categories.some((c) => c.code.toLowerCase() === parsed.data.code.toLowerCase())) {
    return NextResponse.json({ error: "A category with that code already exists" }, { status: 409 });
  }

  const now = new Date().toISOString();
  const category = { id: uuid(), ...parsed.data, active: true, createdAt: now, updatedAt: now };

  await updateDb((current) => {
    current.categories.push(category);
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "CREATE",
      entityType: "ClassifiedCategory",
      entityId: category.id,
      newValue: category,
    });
  });

  return NextResponse.json({ category }, { status: 201 });
}

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const GET = withApiHandler(handleGET);
export const POST = withApiHandler(handlePOST);
