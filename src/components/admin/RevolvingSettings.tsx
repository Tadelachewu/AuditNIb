"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api-client";
import { Button } from "@/components/ui/Button";
import { Label } from "@/components/ui/Field";
import { notify, notifications, presentError } from "@/lib/notify";
import type { AdjustmentConfig } from "@/lib/adjustments/types";

/**
 * Settings -> Revolving Findings: the operation areas whose outstanding
 * findings can be adjusted (cases added, amount changed) instead of
 * registered again - docs/revolving-findings.md. Self-contained: loads and
 * saves through /api/admin/adjustments/config with its own Save.
 */
export function RevolvingSettings({ canEdit }: { canEdit: boolean }) {
  const [state, setState] = useState<{ config: AdjustmentConfig; operationAreas: string[] } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ config: AdjustmentConfig; operationAreas: string[] }>("/api/admin/adjustments/config")
      .then((res) => {
        setState(res);
        setSelected(res.config.revolvingOperationAreas);
      })
      .catch((err) => setError(presentError(err, notifications.adjustment.loadFailed).message));
  }, []);

  if (error && !state) return <p className="p-4 text-sm text-red-600">{error}</p>;
  if (!state) return <p className="p-4 text-sm text-slate-500">Loading…</p>;

  const isOn = (area: string) => selected.some((s) => s.toLowerCase() === area.toLowerCase());
  const toggle = (area: string) => setSelected((cur) => (isOn(area) ? cur.filter((s) => s.toLowerCase() !== area.toLowerCase()) : [...cur, area]));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await apiSend<{ config: AdjustmentConfig }>("/api/admin/adjustments/config", "PATCH", { revolvingOperationAreas: selected });
      setState((s) => (s ? { ...s, config: res.config } : s));
      setSelected(res.config.revolvingOperationAreas);
      notify.success(notifications.adjustment.settingsSaved);
    } catch (err) {
      setError(notify.formError(err, notifications.adjustment.settingsSaveFailed));
    } finally {
      setSaving(false);
    }
  }

  return (
    <fieldset disabled={!canEdit} className="flex flex-col gap-4 p-4">
      <div>
        <Label>Revolving operation areas</Label>
        <p className="mb-2 text-xs text-slate-500">
          An outstanding finding in one of these areas, in the current period, can be <strong>adjusted</strong> by its registrant&apos;s role: cases
          added and the amount increased or decreased, approved like a registration. The original registration never changes. Removing an
          area stops new adjustments; ones already in review can still finish.
        </p>
        {state.operationAreas.length === 0 ? (
          <p className="text-sm text-slate-500">No operation areas configured yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {state.operationAreas.map((area) => (
              <label key={area} className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={isOn(area)} onChange={() => toggle(area)} />
                {area}
              </label>
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {canEdit && (
        <div>
          <Button type="button" onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Save revolving findings"}
          </Button>
        </div>
      )}
    </fieldset>
  );
}
