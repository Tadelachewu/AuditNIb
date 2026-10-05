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
  const auth = await requirePermission("sources.view");
  if (!auth.ok) return auth.response;
  const db = await readDb();
  // Alphabetical by name - same convention as /api/admin/branches/districts,
  // and every picker across the app that lists sources reads from here.
  const sources = [...db.sources].sort((a, b) => a.name.localeCompare(b.name));
  // ?page=... -> one page of the Finding Sources table (searched / filtered / sorted on the server).
  const paged = listPageJson(request, "sources", sources, {
    fields: {
      code: (s) => s.code,
      name: (s) => s.name,
      status: (s) => (s.active ? "Active" : "Inactive"),
      default: (s) => (s.isDefault ? "Default" : ""),
    },
    exact: ["status", "default"],
  });
  if (paged) return NextResponse.json(paged);

  return NextResponse.json({ sources });
}

const createSchema = z.object({
  code: zCode(),
  name: zEntityName(),
});

async function handlePOST(request: Request) {
  const auth = await requirePermission("sources.create");
  if (!auth.ok) return auth.response;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const db = await readDb();
  if (db.sources.some((s) => s.code.toLowerCase() === parsed.data.code.toLowerCase())) {
    return NextResponse.json({ error: "A source with that code already exists" }, { status: 409 });
  }

  const now = new Date().toISOString();
  const source = { id: uuid(), ...parsed.data, active: true, isDefault: false, createdAt: now, updatedAt: now };

  await updateDb((current) => {
    current.sources.push(source);
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "CREATE",
      entityType: "Source",
      entityId: source.id,
      newValue: source,
    });
  });

  return NextResponse.json({ source }, { status: 201 });
}

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const GET = withApiHandler(handleGET);
export const POST = withApiHandler(handlePOST);
