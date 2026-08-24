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
        categories={db.categories.filter((c) => c.active)}
        periods={db.reportingPeriods.filter((p) => p.status === "OPEN")}
        districts={db.districts.filter((d) => d.status === "ACTIVE")}
        branches={db.branches.filter((b) => b.status === "ACTIVE")}
        currencies={db.settings.currencies}
        riskLevels={db.settings.riskLevels}
        fixedDistrict={user.orgScope === "BRANCH" && district ? { id: district.id, name: district.name } : undefined}
        fixedBranch={user.orgScope === "BRANCH" && branch ? { id: branch.id, name: branch.name } : undefined}
      />
    </div>
  );
}
