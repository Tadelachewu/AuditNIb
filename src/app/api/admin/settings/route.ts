import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";
import { FONT_KEYS, TEXT_SIZE_KEYS, TEXT_CONTRAST_KEYS, CHROME_KEYS, normalizeTypography } from "@/lib/typography";

export async function GET() {
  const auth = await requirePermission("settings.view");
  if (!auth.ok) return auth.response;
  const db = await readDb();
  return NextResponse.json({ settings: db.settings });
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
  // Per-report-template source inclusion: keys are REPORT_TEMPLATES slugs,
  // values are arrays of Source IDs. Each source ID is validated against
  // the actual sources table server-side below (in the PATCH handler),
  // not in Zod, since Zod doesn't have DB access.
  reportTemplateSources: z.record(z.string(), z.array(z.string())),
  // Optional so a client that predates the Typography section doesn't
  // reset it to defaults on save - omitted means "keep what's stored".
  typography: z
    .object({
      fontFamily: z.enum(FONT_KEYS),
      textSize: z.enum(TEXT_SIZE_KEYS),
      textContrast: z.enum(TEXT_CONTRAST_KEYS),
      // Optional so a client that predates the header/sidebar color option
      // doesn't fail validation; normalizeTypography() fills the default.
      chrome: z.enum(CHROME_KEYS).optional(),
    })
    .optional(),
});

export async function PATCH(request: Request) {
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

  const updated = await updateDb((current) => {
    current.settings = {
      ...parsed.data,
      reportTemplateSources: parsed.data.reportTemplateSources as Record<string, string[]>,
      typography: parsed.data.typography
        ? normalizeTypography({ ...current.settings.typography, ...parsed.data.typography })
        : current.settings.typography,
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
