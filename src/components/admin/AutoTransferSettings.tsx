"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api-client";
import { Button } from "@/components/ui/Button";
import { CheckboxField, Input, Label } from "@/components/ui/Field";
import { notify, notifications, presentError } from "@/lib/notify";
import type { AutoTransferConfig } from "@/lib/autoTransfer/types";

/**
 * Settings -> Automatic Transfer: on/off, operation areas excluded from it,
 * and an optional delay. Self-contained - loads and saves through
 * /api/admin/auto-transfer (src/lib/autoTransfer), with its own Save,
 * independent of the rest of the Settings form.
 */
export function AutoTransferSettings({ canEdit }: { canEdit: boolean }) {
  const [state, setState] = useState<{ installed: boolean; config: AutoTransferConfig | null; operationAreas: string[] } | null>(null);
  const [draft, setDraft] = useState({ enabled: true, excludedOperationAreas: [] as string[], delayHours: "0" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ installed: boolean; config: AutoTransferConfig | null; operationAreas: string[] }>("/api/admin/auto-transfer")
      .then((res) => {
        setState(res);
        if (res.config) setDraft({ enabled: res.config.enabled, excludedOperationAreas: res.config.excludedOperationAreas, delayHours: String(res.config.delayHours) });
      })
      .catch((err) => setError(presentError(err, notifications.autoTransfer.loadFailed).message));
  }, []);

  if (error && !state) return <p className="p-4 text-sm text-red-600">{error}</p>;
  if (!state) return <p className="p-4 text-sm text-slate-500">Loading…</p>;
  if (!state.installed) {
    return (
      <p className="m-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
        Automatic transfer isn&apos;t installed on this database yet. Apply its migration (see docs/auto-transfer.md); until then nothing is
        transferred automatically.
      </p>
    );
  }

  const delay = Number(draft.delayHours);
  const delayProblem = !/^\d+$/.test(draft.delayHours) || delay > 720 ? "Enter whole hours from 0 to 720" : null;
  // Choices: every known area, plus any excluded one no longer in the list.
  const choices = [...new Set([...state.operationAreas, ...draft.excludedOperationAreas])].sort((a, b) => a.localeCompare(b));
  const toggleArea = (area: string) =>
    setDraft((d) => ({
      ...d,
      excludedOperationAreas: d.excludedOperationAreas.includes(area) ? d.excludedOperationAreas.filter((a) => a !== area) : [...d.excludedOperationAreas, area],
    }));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await apiSend<{ config: AutoTransferConfig }>("/api/admin/auto-transfer", "PATCH", { ...draft, delayHours: delay });
      setState((s) => (s ? { ...s, config: res.config } : s));
      notify.success(notifications.autoTransfer.saved);
    } catch (err) {
      setError(notify.formError(err, notifications.autoTransfer.saveFailed));
    } finally {
      setSaving(false);
    }
  }

  return (
    <fieldset disabled={!canEdit} className="flex flex-col gap-4 p-4">
      <CheckboxField
        id="auto-transfer-enabled"
        label="Transfer outstanding findings automatically when a reporting period ends"
        checked={draft.enabled}
        onChange={(enabled) => setDraft((d) => ({ ...d, enabled }))}
      />
      <p className="-mt-2 text-xs text-slate-500">
        Once a period&apos;s end <strong>and</strong> its submission window have passed, every finding still outstanding in it (sent to the branch,
        partly rectified, rectified but not closed, returned for correction, transferred) is carried into the <strong>next period</strong>,
        once. Unclosed rectification goes back to the branch, as with any transfer. Locking a period no longer transfers anything.
      </p>

      <div>
        <Label>Operation areas excluded from automatic transfer</Label>
        <p className="mb-2 text-xs text-slate-500">
          Findings in these areas stay in their period when it ends; transfer them manually when needed.
        </p>
        {choices.length === 0 ? (
          <p className="text-sm text-slate-500">No operation areas configured yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {choices.map((area) => (
              <label key={area} className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={draft.excludedOperationAreas.includes(area)} onChange={() => toggleArea(area)} />
                {area}
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="max-w-xs">
        <Label htmlFor="auto-transfer-delay">Run after (hours past the period end)</Label>
        <Input id="auto-transfer-delay" type="number" min={0} max={720} step={1} value={draft.delayHours} onChange={(e) => setDraft((d) => ({ ...d, delayHours: e.target.value }))} />
        {delayProblem ? <p className="mt-1 text-xs text-red-600">{delayProblem}</p> : <p className="mt-1 text-xs text-slate-500">0 = as soon as it ends.</p>}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {canEdit && (
        <div>
          <Button type="button" onClick={save} disabled={saving || Boolean(delayProblem)}>
            {saving ? "Saving..." : "Save automatic transfer"}
          </Button>
        </div>
      )}
    </fieldset>
  );
}
