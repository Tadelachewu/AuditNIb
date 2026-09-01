"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Pagination } from "@/components/ui/Pagination";
import type { AuditLogEntry } from "@/types";

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState({ total: 0, pageSize: 50, totalPages: 1 });

  useEffect(() => {
    setLoading(true);
    apiGet<{ auditLogs: AuditLogEntry[]; total: number; pageSize: number; totalPages: number }>(
      `/api/admin/audit-log?page=${page}`
    ).then((res) => {
      setLogs(res.auditLogs);
      setPageInfo({ total: res.total, pageSize: res.pageSize, totalPages: res.totalPages });
      setLoading(false);
    });
  }, [page]);

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Audit Log</h1>
      <p className="mt-1 text-sm text-slate-500">Immutable record of workflow, configuration and authentication events.</p>

      <Card className="mt-5">
        <CardHeader title="Recent Events" description={`${pageInfo.total} total`} />
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
                    <td className="px-4 py-2 text-xs text-slate-400 whitespace-nowrap">{formatDateTime(l.timestamp)}</td>
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
        <Pagination page={page} totalPages={pageInfo.totalPages} total={pageInfo.total} pageSize={pageInfo.pageSize} onPageChange={setPage} />
      </Card>
    </div>
  );
}
