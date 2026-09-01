import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import { REPORT_TEMPLATES } from "@/lib/reportTemplates";
import { Card, CardHeader } from "@/components/ui/Card";

// The bank's own named Internal Control Division reports (see report/*.xlsx)
// as real, permission-gated pages - each card only appears for a viewer who
// holds that specific template's permission, so an admin can grant any
// subset via /admin/roles rather than an all-or-nothing toggle.
export default async function ReportTemplatesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!hasPermission(user.permissions, permissionKey("report-templates", "view"))) redirect("/dashboard");

  const visible = REPORT_TEMPLATES.filter((t) => hasPermission(user.permissions, permissionKey("report-templates", t.action)));

  return (
    <div>
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Report Templates</h1>
        <p className="mt-1 text-sm text-slate-500">
          The bank&apos;s own Internal Control Division reports, computed live from current findings data.
        </p>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.length === 0 && (
          <Card className="p-4 sm:col-span-2 lg:col-span-3">
            <p className="text-sm text-slate-400">
              Your role doesn&apos;t currently have access to any report template. Ask an administrator to grant one under Roles &amp;
              Permissions → Report Templates.
            </p>
          </Card>
        )}
        {visible.map((t) => (
          <Link key={t.slug} href={`/reports/templates/${t.slug}`}>
            <Card className="h-full transition-colors hover:border-slate-300 hover:bg-slate-50">
              <CardHeader title={t.label} description={t.description} />
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
