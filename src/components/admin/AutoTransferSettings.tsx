"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api-client";
import { Button } from "@/components/ui/Button";
import { CheckboxField, Input } from "@/components/ui/Field";
import { Label } from "@/components/admin/AdminLabel";
import { notify, notifications, presentError } from "@/lib/notify";
import type { AreaSources, AutoTransferConfig } from "@/lib/autoTransfer/types";

type SourceChoice = { id: string; code: string; name: string; active: boolean };
type Loaded = { installed: boolean; config: AutoTransferConfig | null; operationAreas: string[]; sources: SourceChoice[] };

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Settings -> Automatic Transfer: on/off, what it transfers (a grid of
 * operation areas x sources - a ticked box is transferred),
 * and an optional delay. Self-contained - loads and saves through
 * /api/admin/auto-transfer (src/lib/autoTransfer), with its own Save,
 * independent of the rest of the Settings form.
 */
export function AutoTransferSettings({ canEdit }: { canEdit: boolean }) {
  const [state, setState] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState({ enabled: true, includedAreaSources: [] as AreaSources[], delayHours: "0" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Loaded>("/api/admin/auto-transfer")
      .then((res) => {
        setState(res);
        if (res.config) setDraft({ enabled: res.config.enabled, includedAreaSources: res.config.includedAreaSources, delayHours: String(res.config.delayHours) });
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
  // Database behind on migrations: the older list stays in force - show, don't save.
  const migrationPending = Boolean(state.config?.legacy);
  // Rows: every known area, plus any ticked one no longer in the list.
  const areas = [...new Map([...state.operationAreas, ...draft.includedAreaSources.map((r) => r.operationArea)].map((a) => [norm(a), a])).values()].sort((a, b) =>
    a.localeCompare(b)
  );
  // Columns: the active sources, plus any inactive one still ticked somewhere.
  const tickedIds = new Set(draft.includedAreaSources.flatMap((r) => r.sourceIds));
  const sources = state.sources.filter((s) => s.active || tickedIds.has(s.id));
  const allIds = sources.map((s) => s.id);
  const idsOf = (area: string) => draft.includedAreaSources.find((r) => norm(r.operationArea) === norm(area))?.sourceIds ?? [];
  /** Sets one area's sources; an area with none ticked drops out of the list. */
  const setArea = (rows: AreaSources[], area: string, sourceIds: string[]) => [
    ...rows.filter((r) => norm(r.operationArea) !== norm(area)),
    ...(sourceIds.length > 0 ? [{ operationArea: area, sourceIds }] : []),
  ];
  const toggleCell = (area: string, id: string) =>
    setDraft((d) => {
      const now = d.includedAreaSources.find((r) => norm(r.operationArea) === norm(area))?.sourceIds ?? [];
      return { ...d, includedAreaSources: setArea(d.includedAreaSources, area, now.includes(id) ? now.filter((x) => x !== id) : [...now, id]) };
    });
  const rowFull = (area: string) => allIds.length > 0 && allIds.every((id) => idsOf(area).includes(id));
  const colFull = (id: string) => areas.length > 0 && areas.every((a) => idsOf(a).includes(id));
  // The area's own box: on while any of its sources is ticked. Ticking it takes every source; unticking it drops the area.
  const rowOn = (area: string) => idsOf(area).length > 0;
  const toggleRow = (area: string) => setDraft((d) => ({ ...d, includedAreaSources: setArea(d.includedAreaSources, area, rowOn(area) ? [] : allIds) }));
  const toggleColumn = (id: string) =>
    setDraft((d) => {
      const full = colFull(id);
      return {
        ...d,
        includedAreaSources: areas.reduce((rows, a) => {
          const now = rows.find((r) => norm(r.operationArea) === norm(a))?.sourceIds ?? [];
          return setArea(rows, a, full ? now.filter((x) => x !== id) : [...new Set([...now, id])]);
        }, d.includedAreaSources),
      };
    });
  const allTicked = areas.length > 0 && areas.every(rowFull);
  const nothingTicked = draft.includedAreaSources.every((r) => r.sourceIds.length === 0);
  const box = "h-4 w-4 rounded border-slate-300";

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await apiSend<{ config: AutoTransferConfig }>("/api/admin/auto-transfer", "PATCH", { ...draft, delayHours: delay });
      setDraft((d) => ({ ...d, includedAreaSources: res.config.includedAreaSources }));
      setState((s) => (s ? { ...s, config: res.config } : s));
      notify.success(notifications.autoTransfer.saved);
    } catch (err) {
      setError(notify.formError(err, notifications.autoTransfer.saveFailed));
    } finally {
      setSaving(false);
    }
  }

  return (
    <fieldset disabled={!canEdit || migrationPending} className="flex flex-col gap-4 p-4">
      {migrationPending && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          This database still uses an older operation-area list, which stays in force. Apply the pending migrations (
          <code>npx prisma migrate deploy</code>) to choose the areas and sources to transfer here.
        </p>
      )}
      <CheckboxField
        id="auto-transfer-enabled"
        label="Transfer outstanding findings automatically when a reporting period stops being the current period"
        checked={draft.enabled}
        onChange={(enabled) => setDraft((d) => ({ ...d, enabled }))}
      />
      <p className="-mt-2 text-xs text-slate-500">
        The current period is the previous calendar month&apos;s. On the <strong>1st of each month</strong> the next period becomes current, and
        every finding still outstanding in the old one (sent to the branch, partly rectified, rectified but not closed, returned for
        correction, transferred) is carried into the <strong>new current period</strong>, once. Unclosed rectification goes back to the branch, as with any transfer. Locking a period no longer transfers anything.
      </p>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label>Operation areas and sources to transfer automatically</Label>
          {areas.length > 0 && sources.length > 0 && !migrationPending && (
            <button
              type="button"
              className="text-xs font-medium text-blue-700 hover:underline disabled:text-slate-400 disabled:no-underline"
              onClick={() => setDraft((d) => ({ ...d, includedAreaSources: allTicked ? [] : areas.map((a) => ({ operationArea: a, sourceIds: allIds })) }))}
            >
              {allTicked ? "Clear all" : "Tick all"}
            </button>
          )}
        </div>
        <p className="mb-2 text-xs text-slate-500">
          A <strong>ticked</strong> box means findings of that source in that operation area are carried into the next period when theirs
          ends. Everything unticked stays where it is; transfer it manually when needed. Ticking an operation area
          ticks all its sources; untick the ones to leave out and the area stays ticked. The box under a source ticks its whole column. A
          new operation area or source starts unticked.
        </p>
        {migrationPending ? (
          <p className="text-sm text-slate-500">
            {state.config?.legacy?.excludedOperationAreas
              ? `In force now: every operation area is transferred except ${state.config.legacy.excludedOperationAreas.join(", ") || "none"}.`
              : `In force now: transferred for every source - ${state.config?.legacy?.includedOperationAreas?.join(", ") || "no operation area"}.`}
          </p>
        ) : areas.length === 0 ? (
          <p className="text-sm text-slate-500">No operation areas configured yet.</p>
        ) : sources.length === 0 ? (
          <p className="text-sm text-slate-500">No active sources configured yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="no-row-hover w-full text-sm text-slate-700">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Operation area</th>
                  {sources.map((s) => (
                    <th key={s.id} scope="col" className="px-3 py-2 text-center font-medium">
                      <label className="inline-flex flex-col items-center gap-1">
                        <span>
                          {s.name}
                          {!s.active && " (inactive)"}
                        </span>
                        <input type="checkbox" className={box} aria-label={`All operation areas for ${s.name}`} checked={colFull(s.id)} onChange={() => toggleColumn(s.id)} />
                      </label>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {areas.map((area) => (
                  <tr key={area}>
                    <th scope="row" className="px-3 py-1.5 text-left font-normal">
                      <label className="flex items-center gap-2">
                        <input type="checkbox" className={box} aria-label={`Transfer ${area}`} checked={rowOn(area)} onChange={() => toggleRow(area)} />
                        {area}
                      </label>
                    </th>
                    {sources.map((s) => (
                      <td key={s.id} className="px-3 py-1.5 text-center">
                        <input type="checkbox" className={box} aria-label={`${area} - ${s.name}`} checked={idsOf(area).includes(s.id)} onChange={() => toggleCell(area, s.id)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!migrationPending && draft.enabled && areas.length > 0 && sources.length > 0 && nothingTicked && (
          <p className="mt-2 text-xs text-amber-700">Nothing is ticked, so nothing will be transferred automatically.</p>
        )}
      </div>

      <div className="max-w-xs">
        <Label htmlFor="auto-transfer-delay">Run after (hours past 00:00 on the 1st)</Label>
        <Input id="auto-transfer-delay" type="number" min={0} max={720} step={1} value={draft.delayHours} onChange={(e) => setDraft((d) => ({ ...d, delayHours: e.target.value }))} />
        {delayProblem ? <p className="mt-1 text-xs text-red-600">{delayProblem}</p> : <p className="mt-1 text-xs text-slate-500">0 = at 00:00 on the 1st.</p>}
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
