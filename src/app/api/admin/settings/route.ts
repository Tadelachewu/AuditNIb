import { NextResponse } from "next/server";
import { NOTIFICATION_EVENT_TYPES } from "@/lib/notificationEvents";
import { z } from "zod";
import { emailError, hostError, LIMITS, zUniqueList } from "@/lib/inputRules";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";
import { withApiHandler } from "@/lib/api/handler";

async function handleGET() {
  const auth = await requirePermission("settings.view");
  if (!auth.ok) return auth.response;
  const db = await readDb();
  return NextResponse.json({ settings: db.settings });
}

const updateSchema = z.object({
  currencies: zUniqueList("Currency").min(1, "At least one currency is required"),
  riskLevels: zUniqueList("Risk level").min(1, "At least one risk level is required"),
  operationAreas: zUniqueList("Operation area").min(1, "At least one operation area is required"),
  priorityLevels: zUniqueList("Priority level").min(1, "At least one priority level is required"),
  irregularityTypes: zUniqueList("Irregularity type").min(1, "At least one irregularity type is required"),
  notification: z.object({
    provider: z.enum(["NONE", "SMTP", "GRAPH"]),
    fromAddress: z.string().trim().max(LIMITS.email.max),
    smtpHost: z.string().optional(),
    smtpPort: z.number().int().min(1, "SMTP port must be 1-65535").max(65535, "SMTP port must be 1-65535").optional(),
    // Per-event email on/off (src/lib/notificationEvents.ts); keys checked below.
    emailEvents: z.record(z.string(), z.boolean()).optional(),
  }).superRefine((n, ctx) => {
    // Email on: a real sender address, and for SMTP a host and port.
    if (n.provider === "NONE") return;
    const fromProblem = emailError(n.fromAddress, "From address");
    if (fromProblem) ctx.addIssue({ code: "custom", path: ["fromAddress"], message: fromProblem });
    if (n.provider === "SMTP") {
      const hostProblem = hostError(n.smtpHost);
      if (hostProblem) ctx.addIssue({ code: "custom", path: ["smtpHost"], message: hostProblem });
      if (!n.smtpPort) ctx.addIssue({ code: "custom", path: ["smtpPort"], message: "SMTP port is required" });
    }
  }),
  rankingVisibility: z.object({
    branches: z.boolean(),
    districts: z.boolean(),
  }),
  rectificationReminders: z.object({
    enabled: z.boolean(),
    thresholdDays: z.number().int().min(1).max(365),
    sendAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Reminder time must be HH:mm (00:00 - 23:59)").optional(),
    days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
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
  // Per-report-template source inclusion: keys are REPORT_TEMPLATES slugs,
  // values are arrays of Source IDs. Each source ID is validated against
  // the actual sources table server-side below (in the PATCH handler),
  // not in Zod, since Zod doesn't have DB access.
  reportTemplateSources: z.record(z.string(), z.array(z.string())),
});

async function handlePATCH(request: Request) {
  const auth = await requirePermission("settings.edit");
  if (!auth.ok) return auth.response;

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const db = await readDb();
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

  // Per-template source filter validation: every referenced source ID must
  // exist (an inactive source is still allowed, since a report's filter may
  // legitimately want to include historical data from a decommissioned
  // source), and every key must be a known REPORT_TEMPLATES slug - unknown
  // slugs would silently never match anything and confuse the admin who
  // typed it in, so reject them up-front.
  const validSourceIds = new Set(db.sources.map((s) => s.id));
  const validSlugs = new Set(["uncovered-branches", "category-detail-by-district", "monthly-summary", "monthly-district-history", "monthly-district-detail", "district-ranking-other-cases", "weekly-executive-summary", "district-ranking-all-cases", "category-performance-summary", "mid-month-district-snapshot", "transferred-findings"]);
  for (const [slug, ids] of Object.entries(parsed.data.reportTemplateSources) as [string, string[]][]) {
    if (!validSlugs.has(slug)) {
      return NextResponse.json({ error: `Unknown report template slug: ${slug}` }, { status: 400 });
    }
    const bad = ids.filter((id: string) => !validSourceIds.has(id));
    if (bad.length > 0) {
      return NextResponse.json({ error: `Template "${slug}" references unknown source ID(s): ${bad.join(", ")}` }, { status: 400 });
    }
  }

  const unknownEvents = Object.keys(parsed.data.notification.emailEvents ?? {}).filter((t) => !NOTIFICATION_EVENT_TYPES.includes(t));
  if (unknownEvents.length > 0) {
    return NextResponse.json({ error: `Unknown notification event(s): ${unknownEvents.join(", ")}` }, { status: 400 });
  }

  const updated = await updateDb((current) => {
    current.settings = {
      ...parsed.data,
      reportTemplateSources: parsed.data.reportTemplateSources as Record<string, string[]>,
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

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const GET = withApiHandler(handleGET);
export const PATCH = withApiHandler(handlePATCH);
