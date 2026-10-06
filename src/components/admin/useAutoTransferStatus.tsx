"use client";

import { useEffect, useMemo, useState } from "react";
import { apiGet } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import type {
  AutoTransferConfig,
  AutoTransferRun,
} from "@/lib/autoTransfer/types";

interface StatusData {
  installed: boolean;
  config: AutoTransferConfig | null;
  runs: AutoTransferRun[];
  dueAt: Record<string, string>;
}

/**
 * Each reporting period's automatic-transfer status, for the Reporting
 * Periods list - fetched from the module's own API (src/lib/autoTransfer),
 * refreshed whenever the list changes. Returns a per-period renderer.
 */
export function useAutoTransferStatus(rows: { id: string; code: string }[]) {
  const [data, setData] = useState<StatusData | null>(null);
  const key = rows.map((r) => r.id).join(",");

  useEffect(() => {
    apiGet<StatusData>("/api/admin/auto-transfer", { background: true })
      .then(setData)
      .catch(() => setData(null));
  }, [key]);

  // Stable between renders (so the table's columns aren't rebuilt each time).
  return useMemo(() => {
    const codeOf = new Map(rows.map((r) => [r.id, r.code]));

    /** Short label (for search / export) and a badge (for the cell). */
    function statusFor(periodId: string): {
      text: string;
      cell: React.ReactNode;
    } {
      if (!data)
        return {
          text: "",
          cell: <span className="text-xs text-slate-400">…</span>,
        };
      if (!data.installed)
        return {
          text: "Not installed",
          cell: <Badge tone="gray">Not installed</Badge>,
        };
      const run = data.runs.find((r) => r.periodId === periodId);
      if (run?.status === "DONE") {
        const to = run.toPeriodId
          ? (codeOf.get(run.toPeriodId) ?? "next period")
          : "next period";
        const text = `Done ${formatDateTime(run.ranAt)} - ${run.movedCount} moved to ${to}${run.keptCount ? `, ${run.keptCount} kept (excluded)` : ""}`;
        return {
          text,
          cell: (
            <span title={text}>
              <Badge tone="green">Done</Badge>{" "}
              <span className="text-xs text-slate-500">
                {run.movedCount} moved
                {run.keptCount ? `, ${run.keptCount} kept` : ""}
              </span>
            </span>
          ),
        };
      }
      if (run?.status === "SKIPPED_AT_RELEASE") {
        const text =
          "Ended before automatic transfer was installed - not swept";
        return {
          text,
          cell: (
            <span title={text}>
              <Badge tone="gray">Before install</Badge>
            </span>
          ),
        };
      }
      if (run?.status === "WAITING_NO_NEXT") {
        const text = "Ended - waiting for the next period to be created";
        return {
          text,
          cell: (
            <span title={text}>
              <Badge tone="amber">Waiting: no next period</Badge>
            </span>
          ),
        };
      }
      if (!data.config?.enabled)
        return { text: "Off", cell: <Badge tone="gray">Off</Badge> };
      const due = data.dueAt[periodId];
      const text = due ? `Runs after ${formatDateTime(due)}` : "Pending";
      return {
        text,
        cell: <span className="text-xs text-slate-500">{text}</span>,
      };
    }

    return { statusFor };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, key]);
}
