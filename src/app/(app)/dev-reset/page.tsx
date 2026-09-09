"use client";

// =============================================================================
// DEV-ONLY TOOL - NOT FOR PRODUCTION. See src/lib/devResetRegisteredData.ts's
// own doc comment for the full picture: exact scope, why it's isolated the
// way it is, and the three files to delete to remove this feature entirely
// before a production release. Deliberately not linked from src/lib/nav.ts's
// sidebar - reach it by URL (/dev-reset) - so the feature leaves no trace
// anywhere else in the app.
//
// Deliberately NOT under /admin/<x> - proxy.ts enforces a blanket "every
// /admin/<x> route requires <x>.view on the session" rule for every path
// matching that shape (see pageCodeFor() there), resolved purely from the
// URL, with no per-route opt-out and no awareness of pages added outside
// its own page registry. A "dev-reset.view" permission was never (and
// deliberately will never be) added to that registry, so putting this page
// at /admin/dev-reset silently redirected literally everyone - including
// Admin - straight to /dashboard before this component, or even the API
// route, ever ran. Living at the top level instead is invisible to that
// check entirely; the real authorization boundary is still enforced twice,
// independently, in the API route itself (NODE_ENV + the literal ADMIN
// role) - this file has no security logic of its own to begin with.
// =============================================================================

import { useEffect, useState } from "react";
import { apiGet, apiSend, ApiError } from "@/lib/api-client";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";

const CONFIRM_PHRASE = "DELETE ALL FINDINGS";

type Counts = Record<string, number>;

interface DevResetSummary {
  clearedCollections: Record<string, number>;
  findingRelatedNotificationsRemoved: number;
  findingRelatedAuditLogsRemoved: number;
  reportingPeriodsUnlocked: string[];
  evidenceFilesDeleted: number;
}

const COLLECTION_LABELS: Record<string, string> = {
  findings: "Findings",
  findingTransitions: "Finding transitions (history)",
  rectifications: "Rectification entries",
  findingTransfers: "Transfer records",
  findingClosures: "Closure records",
  findingCases: "Itemized cases",
  importBatches: "Import batches",
  scoringAdjustments: "Scoring adjustments",
  branchCoverageNotes: "Uncovered-branch notes",
  evidence: "Evidence files",
  comments: "Comments",
};

export default function DevResetPage() {
  const [loading, setLoading] = useState(true);
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<DevResetSummary | null>(null);

  async function load() {
    setLoading(true);
    setUnavailableReason(null);
    try {
      const res = await apiGet<{ counts: Counts }>("/api/admin/dev-reset");
      setCounts(res.counts);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setUnavailableReason("This tool isn't available in this environment (it's disabled whenever NODE_ENV=production).");
      } else if (err instanceof ApiError && err.status === 403) {
        setUnavailableReason("Administrator only.");
      } else {
        setUnavailableReason("Failed to load current data counts.");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleReset() {
    setResetting(true);
    setError(null);
    try {
      const res = await apiSend<{ summary: DevResetSummary }>("/api/admin/dev-reset", "POST", { confirm: confirmText });
      setSummary(res.summary);
      setConfirmText("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Reset failed");
    } finally {
      setResetting(false);
    }
  }

  const totalToDelete = counts ? Object.values(counts).reduce((sum, n) => sum + n, 0) : 0;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Reset Registered Data</h1>
        <p className="mt-1 text-sm text-slate-500">
          Dev/staging tool - permanently deletes every finding and everything generated from one (history, rectifications,
          transfers, closures, itemized cases, import batches, scoring adjustments, uncovered-branch notes, evidence, comments,
          and any Finding-related notification or audit log entry). A reporting period that&apos;s currently locked is reset
          back to open. It never touches users, roles, districts, branches, sources, departments, categories, scoring rules,
          or settings - admin configuration is always preserved.
        </p>
      </div>

      {loading && (
        <Card>
          <p className="p-4 text-sm text-slate-400">Loading...</p>
        </Card>
      )}

      {!loading && unavailableReason && (
        <Card className="border-amber-200">
          <p className="p-4 text-sm text-amber-800">{unavailableReason}</p>
        </Card>
      )}

      {!loading && !unavailableReason && counts && (
        <>
          <Card className="border-red-200">
            <CardHeader
              title="This will permanently delete"
              description={totalToDelete === 0 ? "Nothing to delete - every collection is already empty." : undefined}
            />
            {totalToDelete > 0 && (
              <div className="grid grid-cols-1 gap-1.5 p-4 text-sm sm:grid-cols-2">
                {Object.entries(counts)
                  .filter(([, n]) => n > 0)
                  .map(([key, n]) => (
                    <div key={key} className="flex justify-between gap-2 text-slate-700">
                      <span>{COLLECTION_LABELS[key] ?? key}</span>
                      <span className="font-medium text-slate-900">{n.toLocaleString()}</span>
                    </div>
                  ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Confirm"
              description={totalToDelete === 0 ? "Nothing to reset right now." : `Type "${CONFIRM_PHRASE}" exactly to enable the button below.`}
            />
            <div className="flex flex-col gap-3 p-4">
              <div>
                <Label htmlFor="confirm-text">Confirmation phrase</Label>
                <Input
                  id="confirm-text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={CONFIRM_PHRASE}
                  disabled={totalToDelete === 0}
                />
              </div>
              <div>
                <Button
                  variant="danger"
                  onClick={handleReset}
                  disabled={confirmText !== CONFIRM_PHRASE || resetting || totalToDelete === 0}
                >
                  {resetting ? "Resetting..." : "Reset Registered Data"}
                </Button>
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>
          </Card>
        </>
      )}

      {summary && (
        <Card className="border-emerald-200">
          <CardHeader title="Reset complete" />
          <div className="flex flex-col gap-2 p-4 text-sm text-slate-700">
            <p>
              Deleted{" "}
              {Object.values(summary.clearedCollections)
                .reduce((sum, n) => sum + n, 0)
                .toLocaleString()}{" "}
              record(s) across {Object.keys(summary.clearedCollections).length} collections.
            </p>
            <p>
              Removed {summary.findingRelatedNotificationsRemoved} finding-related notification(s) and{" "}
              {summary.findingRelatedAuditLogsRemoved} finding-related audit log entr(y/ies).
            </p>
            {summary.reportingPeriodsUnlocked.length > 0 && (
              <p>Reopened locked period(s): {summary.reportingPeriodsUnlocked.join(", ")}.</p>
            )}
            {summary.evidenceFilesDeleted > 0 && <p>Deleted {summary.evidenceFilesDeleted} evidence file(s) from disk.</p>}
          </div>
        </Card>
      )}
    </div>
  );
}
