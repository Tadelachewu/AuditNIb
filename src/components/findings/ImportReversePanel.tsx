"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend, errorMessage } from "@/lib/api-client";
import { notify, notifications } from "@/lib/notify";
import { Button } from "@/components/ui/Button";
import { Label, Textarea } from "@/components/ui/Field";
import type { ImportBatch } from "@/types";
import type { ReverseImpact } from "@/lib/importReverse";

/**
 * Reverse an import - always possible, whatever has happened to its
 * findings. Shows the impact first (what will be deleted, incl. work done
 * after the import), then offers Reverse (record kept: re-import later) or
 * Reverse and delete the record. A reason is required either way.
 */
export function ImportReversePanel({ batch, onDone, onCancel }: { batch: ImportBatch; onDone: () => void; onCancel: () => void }) {
  const [impact, setImpact] = useState<ReverseImpact | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState<"reverse" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ impact: ReverseImpact }>(`/api/findings/import/${batch.id}/reverse`)
      .then((r) => setImpact(r.impact))
      .catch((err) => setLoadError(errorMessage(err, "Unable to check what this import affects. Please try again.")));
  }, [batch.id]);

  const hasActivity = (impact?.withActivity.length ?? 0) > 0;
  const canSubmit = Boolean(impact) && reason.trim().length >= 5 && (!hasActivity || acknowledged) && busy === null;

  async function submit(deleteRecord: boolean) {
    setBusy(deleteRecord ? "delete" : "reverse");
    setError(null);
    try {
      const res = await apiSend<{ removed: number }>(`/api/findings/import/${batch.id}/reverse`, "POST", { reason, deleteRecord });
      notify.success(deleteRecord ? notifications.import.deleted : notifications.import.reversed, {
        description: `${res.removed} finding(s) removed from ${batch.fileName}.`,
      });
      onDone();
    } catch (err) {
      // Shown inline: the user is in the middle of this panel.
      setError(errorMessage(err, notifications.import.reverseFailed.message));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-md border border-red-200 bg-red-50 p-3" role="region" aria-label={`Reverse import ${batch.fileName}`}>
      {!impact && !loadError && <p className="text-sm text-slate-600">Checking what this import affects...</p>}
      {loadError && <p className="text-sm text-red-700">{loadError}</p>}
      {impact && (
        <>
          <p className="text-sm text-slate-700">
            This permanently removes the <span className="font-semibold">{impact.findings} finding(s)</span> this import created, and
            everything recorded against them.
            {impact.evidenceFiles > 0 && ` That includes ${impact.evidenceFiles} uploaded evidence file(s).`} The import stays in the
            history (unless you delete it) and can be re-imported. The audit log keeps a full record.
          </p>
          {hasActivity && (
            <div className="rounded-md border border-red-300 bg-white p-2">
              <p className="text-sm font-medium text-red-800">
                {impact.withActivity.length} finding(s) have been worked on since the import. That work will be deleted too:
              </p>
              <ul className="mt-1 max-h-40 list-disc overflow-auto pl-5 text-xs text-slate-700">
                {impact.withActivity.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
              <label className="mt-2 flex items-start gap-2 text-sm text-slate-800">
                <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} className="mt-0.5 h-4 w-4" />
                I understand this work will be permanently deleted.
              </label>
            </div>
          )}
          <div>
            <Label htmlFor={`reverse-${batch.id}`}>Reason (required)</Label>
            <Textarea
              id={`reverse-${batch.id}`}
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Wrong period codes in the file - will re-import corrected"
            />
          </div>
        </>
      )}
      {error && (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="cancel" onClick={onCancel} disabled={busy !== null}>
          Cancel
        </Button>
        <Button variant="danger" onClick={() => submit(true)} disabled={!canSubmit}>
          {busy === "delete" ? "Deleting..." : "Reverse and delete record"}
        </Button>
        <Button variant="danger" onClick={() => submit(false)} disabled={!canSubmit}>
          {busy === "reverse" ? "Reversing..." : "Reverse import"}
        </Button>
      </div>
    </div>
  );
}
