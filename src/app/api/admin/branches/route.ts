import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";
import { findBranchManager, findBranchController, findBranchSubManager } from "@/lib/org";
import { paginate, parsePage } from "@/lib/pagination";

// A large bank can have hundreds of branches - paginated the same way
// Users/Audit Log are. `page` is optional: other callers (e.g. the Users
// page's own branch-picker dropdowns) still want the full list, so
// omitting it returns everything unpaginated, same as before.
export async function GET(request: Request) {
  const auth = await requirePermission("branches.view");
  if (!auth.ok) return auth.response;
  const { searchParams } = new URL(request.url);
  const db = readDb();

  const branches = [...db.branches]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((b) => ({
      ...b,
      managerName: findBranchManager(db, b.id)?.name ?? null,
      subManagerName: findBranchSubManager(db, b.id)?.name ?? null,
      controllerName: findBranchController(db, b.id)?.name ?? null,
    }));

  const pageParam = searchParams.get("page");
  if (!pageParam) return NextResponse.json({ branches });

  const result = paginate(branches, parsePage(pageParam), 25);
  return NextResponse.json({ branches: result.items, total: result.total, page: result.page, pageSize: result.pageSize, totalPages: result.totalPages });
}

const createSchema = z.object({
  code: z.string().min(1, "Code is required"),
  name: z.string().min(1, "Name is required"),
  districtId: z.string().min(1, "District is required"),
});

export async function POST(request: Request) {
  const auth = await requirePermission("branches.create");
  if (!auth.ok) return auth.response;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { code, name, districtId } = parsed.data;

  const db = readDb();
  if (!db.districts.some((d) => d.id === districtId)) {
    return NextResponse.json({ error: "Selected district does not exist" }, { status: 400 });
  }
  if (db.branches.some((b) => b.code.toLowerCase() === code.toLowerCase())) {
    return NextResponse.json({ error: "A branch with that code already exists" }, { status: 409 });
  }

  const now = new Date().toISOString();
  const branch = { id: uuid(), code, name, districtId, status: "ACTIVE" as const, createdAt: now, updatedAt: now };

  updateDb((current) => {
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
