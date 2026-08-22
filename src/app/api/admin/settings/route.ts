import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";

export async function GET() {
  const auth = await requirePermission("settings.view");
  if (!auth.ok) return auth.response;
  return NextResponse.json({ settings: readDb().settings });
}

const updateSchema = z.object({
  currencies: z.array(z.string().min(1)).min(1, "At least one currency is required"),
  riskLevels: z.array(z.string().min(1)).min(1, "At least one risk level is required"),
  notification: z.object({
    provider: z.enum(["NONE", "SMTP", "GRAPH"]),
    fromAddress: z.string(),
    smtpHost: z.string().optional(),
    smtpPort: z.number().int().optional(),
  }),
});

export async function PATCH(request: Request) {
  const auth = await requirePermission("settings.edit");
  if (!auth.ok) return auth.response;

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const db = readDb();
  const before = db.settings;

  const updated = updateDb((current) => {
    current.settings = {
      ...parsed.data,
      updatedAt: new Date().toISOString(),
      updatedBy: auth.session.userId!,
    };
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "UPDATE",
      entityType: "Settings",
      entityId: "settings",
      oldValue: before,
      newValue: current.settings,
    });
    return current.settings;
  });

  return NextResponse.json({ settings: updated });
}
