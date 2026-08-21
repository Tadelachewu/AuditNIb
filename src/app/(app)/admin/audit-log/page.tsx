"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api-client";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { AuditLogEntry } from "@/types";

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<{ auditLogs: AuditLogEntry[] }>("/api/admin/audit-log").then((res) => {
      setLogs(res.auditLogs);
      setLoading(false);
    });
  }, []);

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Audit Log</h1>
      <p className="mt-1 text-sm text-slate-500">Immutable record of workflow, configuration and authentication events.</p>

      <Card className="mt-5">
        <CardHeader title="Recent Events" description={`${logs.length} shown`} />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-2 font-medium">Time</th>
                <th className="px-4 py-2 font-medium">Actor</th>
                <th className="px-4 py-2 font-medium">Action</th>
                <th className="px-4 py-2 font-medium">Entity</th>
                <th className="px-4 py-2 font-medium">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td className="px-4 py-4 text-slate-400" colSpan={5}>
                    Loading...
                  </td>
                </tr>
              )}
              {!loading &&
                logs.map((l) => (
                  <tr key={l.id}>
                    <td className="px-4 py-2 text-xs text-slate-400 whitespace-nowrap">{new Date(l.timestamp).toLocaleString()}</td>
                    <td className="px-4 py-2 text-slate-900">{l.userName}</td>
                    <td className="px-4 py-2">
                      <Badge tone="blue">{l.action}</Badge>
                    </td>
                    <td className="px-4 py-2 text-slate-600">{l.entityType}</td>
                    <td className="px-4 py-2 text-slate-500">{l.reason ?? "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
