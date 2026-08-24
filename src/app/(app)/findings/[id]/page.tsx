import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { readDb } from "@/lib/db";
import { assertFindingInScope } from "@/lib/findings-scope";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import { Card } from "@/components/ui/Card";
import { FindingDetailClient } from "@/components/findings/FindingDetailClient";

export default async function FindingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!hasPermission(user.permissions, permissionKey("findings", "view"))) redirect("/dashboard");

  const { id } = await params;
  const db = readDb();
  const finding = db.findings.find((f) => f.id === id);

  if (!finding) {
    return (
      <Card className="mx-auto max-w-lg p-4">
        <p className="text-sm text-slate-600">Finding not found.</p>
      </Card>
    );
  }

  const scopeError = assertFindingInScope(user, finding);
  if (scopeError) {
    return (
      <Card className="mx-auto max-w-lg p-4">
        <p className="text-sm text-red-600">{scopeError}</p>
      </Card>
    );
  }

  const transitions = db.findingTransitions
    .filter((t) => t.findingId === id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const rectifications = db.rectifications
    .filter((r) => r.findingId === id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const branch = db.branches.find((b) => b.id === finding.branchId);
  const district = db.districts.find((d) => d.id === finding.districtId);
  const source = db.sources.find((s) => s.id === finding.sourceId);
  const category = db.categories.find((c) => c.id === finding.categoryId);
  const period = db.reportingPeriods.find((p) => p.id === finding.periodId);

  const has = (action: string) => hasPermission(user.permissions, permissionKey("findings", action));

  return (
    <FindingDetailClient
      finding={finding}
      transitions={transitions}
      rectifications={rectifications}
      lookups={{
        branchName: branch?.name ?? "Unknown branch",
        districtName: district?.name ?? "Unknown district",
        sourceName: source?.name ?? "Unknown source",
        categoryName: category?.name ?? "Unknown category",
        periodCode: period?.code ?? "Unknown period",
      }}
      permissions={{
        canEdit: has("edit") && ["DRAFT", "RETURNED"].includes(finding.status),
        canDelete: has("delete") && finding.status === "DRAFT",
        canSubmit: has("submit") && ["DRAFT", "RETURNED"].includes(finding.status),
        canDistrictReview: has("district-review") && finding.status === "DISTRICT_REVIEW",
        canHoReview: has("ho-review") && finding.status === "HO_REVIEW",
        canRectify: has("rectify") && ["SENT_TO_BRANCH_MANAGER", "PARTIALLY_RECTIFIED"].includes(finding.status),
        canClose: has("close") && finding.status === "RECTIFIED",
      }}
    />
  );
}
