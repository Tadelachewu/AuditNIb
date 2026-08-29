import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { readDb } from "@/lib/db";
import { assertFindingInScope } from "@/lib/findings-scope";
import { caseAgeDays } from "@/lib/findings";
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
  const transfers = db.findingTransfers
    .filter((t) => t.findingId === id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const closures = db.findingClosures
    .filter((c) => c.findingId === id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const findingCases = db.findingCases.filter((c) => c.findingId === id).sort((a, b) => a.seq - b.seq);
  const evidence = db.evidence
    .filter((e) => e.findingId === id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const comments = db.comments
    .filter((c) => c.findingId === id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const branch = db.branches.find((b) => b.id === finding.branchId);
  const district = db.districts.find((d) => d.id === finding.districtId);
  const source = db.sources.find((s) => s.id === finding.sourceId);
  const department = db.departments.find((d) => d.id === finding.departmentId);
  const category = db.categories.find((c) => c.id === finding.categoryId);
  const period = db.reportingPeriods.find((p) => p.id === finding.periodId);

  const otherOpenPeriods = db.reportingPeriods
    .filter((p) => p.status === "OPEN" && p.id !== finding.periodId)
    .map((p) => ({ id: p.id, code: p.code }));

  const has = (action: string) => hasPermission(user.permissions, permissionKey("findings", action));

  const TRANSFERABLE_STATUSES = ["SENT_TO_BRANCH_MANAGER", "PARTIALLY_RECTIFIED", "TRANSFERRED"];

  return (
    <FindingDetailClient
      finding={finding}
      transitions={transitions}
      rectifications={rectifications}
      transfers={transfers}
      closures={closures}
      findingCases={findingCases}
      evidence={evidence}
      comments={comments}
      otherOpenPeriods={otherOpenPeriods}
      caseAgeDays={caseAgeDays(finding)}
      operationAreas={db.settings.operationAreas}
      priorityLevels={db.settings.priorityLevels}
      irregularityTypes={db.settings.irregularityTypes}
      editSources={db.sources.filter((s) => s.active)}
      editDepartments={db.departments.filter((d) => d.active)}
      editCategories={db.categories.filter((c) => c.active)}
      editPeriods={db.reportingPeriods.filter((p) => p.status === "OPEN")}
      editDistricts={db.districts.filter((d) => d.status === "ACTIVE")}
      editBranches={db.branches.filter((b) => b.status === "ACTIVE")}
      editCurrencies={db.settings.currencies}
      editRiskLevels={db.settings.riskLevels}
      fixedDistrict={user.orgScope === "BRANCH" && district ? { id: district.id, name: district.name } : undefined}
      fixedBranch={user.orgScope === "BRANCH" && branch ? { id: branch.id, name: branch.name } : undefined}
      lookups={{
        branchName: branch?.name ?? "Unknown branch",
        districtName: district?.name ?? "Unknown district",
        sourceName: source?.name ?? "Unknown source",
        departmentName: department?.name ?? "Unknown department",
        categoryName: category?.name ?? "Unknown category",
        periodCode: period?.code ?? "Unknown period",
      }}
      permissions={{
        canEdit: has("edit") && ["DRAFT", "RETURNED"].includes(finding.status),
        canDelete: has("delete") && finding.status === "DRAFT",
        canSubmit: has("submit") && ["DRAFT", "RETURNED"].includes(finding.status),
        canDistrictReview: has("district-review") && finding.status === "DISTRICT_REVIEW",
        canHoReview: has("ho-review") && finding.status === "HO_REVIEW",
        canRectify:
          has("rectify") &&
          ["SENT_TO_BRANCH_MANAGER", "PARTIALLY_RECTIFIED", "TRANSFERRED", "RECTIFICATION_RETURNED"].includes(finding.status),
        // Closeable whenever there's a rectified-but-not-yet-closed portion
        // waiting, regardless of overall status - see close/route.ts. Not
        // gated to "RECTIFIED" any more so the resolved part of a
        // partially-rectified finding can be verified and closed while the
        // unrectified remainder stays open. Excludes RECTIFICATION_RETURNED -
        // a pending return blocks closing until resubmitted.
        canClose:
          has("close") &&
          finding.status !== "CLOSED" &&
          finding.status !== "RECTIFICATION_RETURNED" &&
          (finding.rectifiedCases > finding.closedCases || finding.rectifiedAmount > finding.closedAmount),
        canTransfer: has("transfer") && TRANSFERABLE_STATUSES.includes(finding.status),
        // Same authority as closing - reviewing a rectification and finding
        // an issue with it is the other branch of the same verify duty.
        canReturnRectification:
          has("close") && ["PARTIALLY_RECTIFIED", "RECTIFIED", "TRANSFERRED"].includes(finding.status),
        canResubmitRectification: has("rectify") && finding.status === "RECTIFICATION_RETURNED",
        canUploadEvidence: has("evidence"),
        canComment: has("comment"),
      }}
    />
  );
}
