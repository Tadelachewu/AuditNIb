import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { zCode, zEntityName } from "@/lib/inputRules";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";
import { findBranchManager, findBranchController, findBranchSubManager } from "@/lib/org";
import { withApiHandler } from "@/lib/api/handler";
import { listPageJson } from "@/lib/serverList";

// A large bank can have hundreds of branches - the Branches table asks for
// one page at a time (?page=..., searched / filtered / sorted on the server,
// src/lib/serverList.ts). Without `page`, other callers (e.g. the branch
// pickers on the Users page) still get the full list, as before.
async function handleGET(request: Request) {
  const auth = await requirePermission("branches.view");
  if (!auth.ok) return auth.response;
  const db = await readDb();

  const branches = [...db.branches]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((b) => ({
      ...b,
      managerName: findBranchManager(db, b.id)?.name ?? null,
      subManagerName: findBranchSubManager(db, b.id)?.name ?? null,
      controllerName: findBranchController(db, b.id)?.name ?? null,
    }));

  const districtName = (id: string) => db.districts.find((d) => d.id === id)?.name ?? "—";
  const paged = listPageJson(request, "branches", branches, {
    fields: {
      code: (b) => b.code,
      name: (b) => b.name,
      district: (b) => districtName(b.districtId),
      manager: (b) => b.managerName ?? "",
      subManager: (b) => b.subManagerName ?? "—",
      controller: (b) => b.controllerName ?? "",
      status: (b) => b.status,
    },
    exact: ["district", "status"],
  });
  if (paged) return NextResponse.json(paged);
  return NextResponse.json({ branches });
}

const createSchema = z.object({
  code: zCode(),
  name: zEntityName(),
  districtId: z.string().min(1, "District is required"),
});

async function handlePOST(request: Request) {
  const auth = await requirePermission("branches.create");
  if (!auth.ok) return auth.response;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { code, name, districtId } = parsed.data;

  const db = await readDb();
  if (!db.districts.some((d) => d.id === districtId)) {
    return NextResponse.json({ error: "Selected district does not exist" }, { status: 400 });
  }
  if (db.branches.some((b) => b.code.toLowerCase() === code.toLowerCase())) {
    return NextResponse.json({ error: "A branch with that code already exists" }, { status: 409 });
  }

  const now = new Date().toISOString();
  const branch = { id: uuid(), code, name, districtId, status: "ACTIVE" as const, createdAt: now, updatedAt: now };

  await updateDb((current) => {
    current.branches.push(branch);
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "CREATE",
      entityType: "Branch",
      entityId: branch.id,
      newValue: branch,
    });
  });

  return NextResponse.json({ branch }, { status: 201 });
}

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const GET = withApiHandler(handleGET);
export const POST = withApiHandler(handlePOST);
