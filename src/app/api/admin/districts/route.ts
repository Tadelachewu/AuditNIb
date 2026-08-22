import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";
import { findDistrictControllers, findDistrictDirectors } from "@/lib/org";

export async function GET() {
  const auth = await requirePermission("districts.view");
  if (!auth.ok) return auth.response;
  const db = readDb();

  // Unlike a branch's manager/controller, a district can have several
  // active District Controllers/Directors (BRD: "District and Head Office
  // may have multiple Internal Controllers"), so these come back as arrays
  // of names, not a single one.
  const districts = db.districts.map((d) => ({
    ...d,
    controllerNames: findDistrictControllers(db, d.id).map((u) => u.name),
    directorNames: findDistrictDirectors(db, d.id).map((u) => u.name),
  }));

  return NextResponse.json({ districts });
}

const createSchema = z.object({
  code: z.string().min(1, "Code is required"),
  name: z.string().min(1, "Name is required"),
});

export async function POST(request: Request) {
  const auth = await requirePermission("districts.create");
  if (!auth.ok) return auth.response;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { code, name } = parsed.data;

  const db = readDb();
  if (db.districts.some((d) => d.code.toLowerCase() === code.toLowerCase())) {
    return NextResponse.json({ error: "A district with that code already exists" }, { status: 409 });
  }

  const now = new Date().toISOString();
  const district = { id: uuid(), code, name, status: "ACTIVE" as const, createdAt: now, updatedAt: now };

  updateDb((current) => {
    current.districts.push(district);
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "CREATE",
      entityType: "District",
      entityId: district.id,
      newValue: district,
    });
  });

  return NextResponse.json({ district }, { status: 201 });
}
