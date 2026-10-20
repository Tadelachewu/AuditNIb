import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { formatDateTime } from "@/lib/format";
import { sortPeriods } from "@/lib/periods";
import type { FindingTransition, ReportingPeriod } from "@/types";

/**
 * The last block of every dashboard (HO, District, Branch, Executive), in
 * the same order everywhere: Reporting Period Status, then Recent Activity.
 */
export function DashboardFooter({ periods, activity, activityDescription }: { periods: ReportingPeriod[]; activity: FindingTransition[]; activityDescription: string }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Reporting Period Status" />
        <div className="divide-y divide-slate-100">
          {sortPeriods(periods).map((p) => (
            <div key={p.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <span className="font-mono text-slate-900">{p.code}</span>
              <Badge tone={p.status === "OPEN" ? "green" : "gray"}>{p.status}</Badge>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Recent Activity" description={activityDescription} />
        <div className="divide-y divide-slate-100">
          {activity.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-500">No activity yet.</p>}
          {activity.map((t) => (
            <div key={t.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <span className="text-slate-600">
                <span className="font-medium text-slate-900">{t.userName}</span> {t.action.replaceAll("_", " ").toLowerCase()}
              </span>
              <span className="text-xs text-slate-500">{formatDateTime(t.createdAt)}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
