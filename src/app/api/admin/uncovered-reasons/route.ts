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
  const auth = await requirePermission("uncovered-reasons.view");
  if (!auth.ok) return auth.response;
  const db = await readDb();
  // Alphabetical by name - same convention as /api/admin/branches/districts,
  // and ReasonPicker.tsx's own picklist reads from here.
  const uncoveredReasons = [...db.uncoveredReasons].sort((a, b) => a.name.localeCompare(b.name));
  // ?page=... -> one page of the Uncovered Reasons table (searched / filtered / sorted on the server).
  const paged = listPageJson(request, "uncoveredReasons", uncoveredReasons, {
    fields: {
      code: (r) => r.code,
      name: (r) => r.name,
      status: (r) => (r.active ? "Active" : "Inactive"),
    },
    exact: ["status"],
  });
  if (paged) return NextResponse.json(paged);

  return NextResponse.json({ uncoveredReasons });
}

const createSchema = z.object({
  code: zCode(),
  name: zEntityName(),
});

async function handlePOST(request: Request) {
  const auth = await requirePermission("uncovered-reasons.create");
  if (!auth.ok) return auth.response;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const db = await readDb();
  if (db.uncoveredReasons.some((r) => r.code.toLowerCase() === parsed.data.code.toLowerCase())) {
    return NextResponse.json({ error: "A reason with that code already exists" }, { status: 409 });
  }

  const now = new Date().toISOString();
  const reason = { id: uuid(), ...parsed.data, active: true, createdAt: now, updatedAt: now };

  await updateDb((current) => {
    current.uncoveredReasons.push(reason);
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "CREATE",
      entityType: "UncoveredReason",
      entityId: reason.id,
      newValue: reason,
    });
  });

  return NextResponse.json({ reason }, { status: 201 });
}

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const GET = withApiHandler(handleGET);
export const POST = withApiHandler(handlePOST);
