import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { readDb } from "@/lib/db";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import { NewFindingForm } from "@/components/findings/NewFindingForm";

export default async function NewFindingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!hasPermission(user.permissions, permissionKey("findings", "create"))) redirect("/findings");

  const db = readDb();
  const district = db.districts.find((d) => d.id === user.districtId);
  const branch = db.branches.find((b) => b.id === user.branchId);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-lg font-semibold text-slate-900">Register Finding</h1>
      <p className="mt-1 text-sm text-slate-500">Save as a draft, or save and submit it into the workflow.</p>

      <NewFindingForm
        sources={db.sources.filter((s) => s.active)}
        departments={db.departments.filter((d) => d.active)}
        categories={db.categories.filter((c) => c.active)}
        // OPEN periods take the full workflow; a LOCKED period only accepts
        // DRAFT writes when draftsAllowedWhileLocked is set (see
        // assertPeriodWritable()) - still listed here so a draft can be
        // registered against it, with NewFindingForm disabling Save & Submit
        // for that case rather than hiding the period entirely.
        periods={db.reportingPeriods.filter((p) => p.status === "OPEN" || p.draftsAllowedWhileLocked)}
        districts={db.districts.filter((d) => d.status === "ACTIVE")}
        branches={db.branches.filter((b) => b.status === "ACTIVE")}
        currencies={db.settings.currencies}
        riskLevels={db.settings.riskLevels}
        operationAreas={db.settings.operationAreas}
        priorityLevels={db.settings.priorityLevels}
        irregularityTypes={db.settings.irregularityTypes}
        fixedDistrict={user.orgScope === "BRANCH" && district ? { id: district.id, name: district.name } : undefined}
        fixedBranch={user.orgScope === "BRANCH" && branch ? { id: branch.id, name: branch.name } : undefined}
      />
    </div>
  );
}
