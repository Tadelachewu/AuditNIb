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
  operationAreas: z.array(z.string().min(1)).min(1, "At least one operation area is required"),
  priorityLevels: z.array(z.string().min(1)).min(1, "At least one priority level is required"),
  irregularityTypes: z.array(z.string().min(1)).min(1, "At least one irregularity type is required"),
  notification: z.object({
    provider: z.enum(["NONE", "SMTP", "GRAPH"]),
    fromAddress: z.string(),
    smtpHost: z.string().optional(),
    smtpPort: z.number().int().optional(),
  }),
  autoTransferOnLock: z.boolean(),
  rankingVisibility: z.object({
    branches: z.boolean(),
    districts: z.boolean(),
  }),
  rectificationReminders: z.object({
    enabled: z.boolean(),
    thresholdDays: z.number().int().min(1).max(365),
    lastCheckedAt: z.string().optional(),
  }),
  performanceThresholds: z.object({
    topPercent: z.number().min(0).max(100),
    bottomPercent: z.number().min(0).max(100),
  }),
  hoApproval: z.object({
    required: z.boolean(),
    approverUserIds: z.array(z.string()),
  }),
  // Keep in sync with SIMILAR_FINDING_FIELDS (src/types/index.ts) - a
  // literal tuple here (same convention as notification.provider above)
  // gets real static typing on Settings.similarFindingFields, which a
  // runtime-only check against that array's keys couldn't.
  similarFindingFields: z
    .array(
      z.enum([
        "districtId",
        "branchId",
        "sourceId",
        "departmentId",
        "categoryId",
        "periodId",
        "findingDate",
        "operationArea",
        "irregularityType",
        "amount",
        "currency",
        "caseCount",
        "riskLevel",
        "priority",
        "title",
        "description",
        "recommendation",
        "rootCause",
        "evidenceNote",
      ])
    )
    .min(1, "Select at least one field for the duplicate-suggestion check"),
  // Keep in sync with REQUIRABLE_FINDING_FIELDS (src/types/index.ts) -
  // same literal-keys-object convention as similarFindingFields above, one
  // boolean per configurable field rather than an array since every one
  // of them needs an explicit true/false, not just a "selected or not."
  requiredFindingFields: z.object({
    title: z.boolean(),
    sourceId: z.boolean(),
    departmentId: z.boolean(),
    findingDate: z.boolean(),
    operationArea: z.boolean(),
    irregularityType: z.boolean(),
    categoryId: z.boolean(),
    currency: z.boolean(),
    riskLevel: z.boolean(),
    priority: z.boolean(),
    description: z.boolean(),
    recommendation: z.boolean(),
    rootCause: z.boolean(),
    evidenceNote: z.boolean(),
  }),
  // Keep in sync with OTHER_VALUE_ALLOWED_FIELDS (src/types/index.ts).
  allowOtherValueFields: z.object({
    operationArea: z.boolean(),
    irregularityType: z.boolean(),
    priority: z.boolean(),
    riskLevel: z.boolean(),
    currency: z.boolean(),
    categoryId: z.boolean(),
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

  // "if there is approval it should be the bank wide user" - every
  // assigned approver must actually hold a BANK-scoped role, not just any
  // active user, since this bypasses the normal district/HO review chain
  // entirely.
  if (parsed.data.hoApproval.approverUserIds.length > 0) {
    const rolesByCode = new Map(db.roles.map((r) => [r.code, r]));
    const invalid = parsed.data.hoApproval.approverUserIds.filter((userId) => {
      const user = db.users.find((u) => u.id === userId);
      const role = user ? rolesByCode.get(user.role) : undefined;
      return !user || user.status !== "ACTIVE" || role?.orgScope !== "BANK";
    });
    if (invalid.length > 0) {
      return NextResponse.json({ error: "Every approver must be an active, bank-wide-scoped user" }, { status: 400 });
    }
  }

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
