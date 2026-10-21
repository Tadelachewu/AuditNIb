"use client";

import { useMemo, useState } from "react";
import { Building2, ChevronDown, ChevronUp, Map as MapIcon, User, Users, X } from "lucide-react";
import { Input } from "@/components/ui/Field";
import { selectionMatcher, type Directory, type DirectoryUser, type RecipientSelection } from "@/lib/communications/types";

type Tab = "roles" | "districts" | "branches" | "people";
const TABS: { id: Tab; label: string; Icon: typeof Users }[] = [
  { id: "roles", label: "Roles", Icon: Users },
  { id: "districts", label: "Districts", Icon: MapIcon },
  { id: "branches", label: "Branches", Icon: Building2 },
  { id: "people", label: "People", Icon: User },
];

export const EMPTY_SELECTION: RecipientSelection = { toAll: false, userIds: [], roleCodes: [], districtIds: [], branchIds: [], excludedUserIds: [] };

type Item = { id: string; label: string; detail?: string; count?: number };

/**
 * The "To" picker (docs/communications.md): Everyone, or ticks in four
 * category lists - Roles, Districts, Branches, People - each with its own
 * filter box. Ticks within a category add up; categories narrow each other
 * (roles IN the ticked places); people ticked one by one are always added and
 * people unticked are left out - the same selectionMatcher() the server uses,
 * so "N people" is exactly who receives it.
 */
export function RecipientPicker({ dir, value, onChange }: { dir: Directory; value: RecipientSelection; onChange: (next: RecipientSelection) => void }) {
  const [tab, setTab] = useState<Tab>("roles");
  const [filter, setFilter] = useState("");
  const [showList, setShowList] = useState(false);

  const districtOfBranch = useMemo(() => new Map(dir.branches.map((b) => [b.id, b.districtId])), [dir]);
  const matcher = useMemo(() => selectionMatcher(value, (id) => districtOfBranch.get(id)), [value, districtOfBranch]);
  const reached = useMemo(() => dir.users.filter(matcher), [dir, matcher]);

  // Counts: how many people each item covers, given the OTHER categories' ticks.
  const placeMatcher = useMemo(
    () => selectionMatcher({ ...EMPTY_SELECTION, districtIds: value.districtIds, branchIds: value.branchIds }, (id) => districtOfBranch.get(id)),
    [value.districtIds, value.branchIds, districtOfBranch]
  );
  const inPlaces = (u: DirectoryUser) => value.districtIds.length + value.branchIds.length === 0 || placeMatcher(u);
  const inRoles = (u: DirectoryUser) => value.roleCodes.length === 0 || value.roleCodes.includes(u.roleCode);

  const lists: Record<Tab, Item[]> = {
    roles: dir.roles.map((r) => ({ id: r.code, label: r.name, count: dir.users.filter((u) => u.roleCode === r.code && inPlaces(u)).length })),
    districts: dir.districts.map((d) => ({ id: d.id, label: d.name, count: dir.users.filter((u) => u.districtId === d.id && inRoles(u)).length })),
    // Narrowed to the ticked districts' branches when districts are ticked.
    branches: dir.branches
      .filter((b) => value.districtIds.length === 0 || value.districtIds.includes(b.districtId))
      .map((b) => ({ id: b.id, label: b.name, detail: dir.districts.find((d) => d.id === b.districtId)?.name, count: dir.users.filter((u) => u.branchId === b.id && inRoles(u)).length })),
    people: dir.users.map((u) => ({ id: u.id, label: u.name, detail: [u.roleName, u.branchName ?? u.districtName].filter(Boolean).join(" · ") })),
  };
  const key: Record<Exclude<Tab, "people">, "roleCodes" | "districtIds" | "branchIds"> = { roles: "roleCodes", districts: "districtIds", branches: "branchIds" };

  const q = filter.trim().toLowerCase();
  const shown = lists[tab].filter((i) => !q || `${i.label} ${i.detail ?? ""}`.toLowerCase().includes(q));

  const isTicked = (t: Tab, id: string) => (t === "people" ? matcher(dir.users.find((u) => u.id === id)!) : value[key[t]].includes(id));

  function set(next: Partial<RecipientSelection>) {
    onChange({ ...value, ...next });
  }
  function toggle(t: Tab, id: string, on: boolean) {
    if (t !== "people") {
      const k = key[t];
      const list = on ? [...new Set([...value[k], id])] : value[k].filter((x) => x !== id);
      // Unticking a district drops its branches too (they were narrowing it).
      const branchIds = t === "districts" && !on ? value.branchIds.filter((b) => districtOfBranch.get(b) !== id) : value.branchIds;
      set({ [k]: list, ...(t === "districts" ? { branchIds } : {}) });
      return;
    }
    const userIds = value.userIds.filter((x) => x !== id);
    const excluded = (value.excludedUserIds ?? []).filter((x) => x !== id);
    const viaGroup = selectionMatcher({ ...value, userIds: [], excludedUserIds: [] }, (b) => districtOfBranch.get(b))(dir.users.find((u) => u.id === id)!);
    if (on) set({ userIds: viaGroup ? userIds : [...userIds, id], excludedUserIds: excluded });
    else set({ userIds, excludedUserIds: viaGroup ? [...excluded, id] : excluded });
  }
  // Select all (shown): one update for every listed item.
  function setAllShown(on: boolean) {
    if (tab === "people") {
      const ids = new Set(shown.map((i) => i.id));
      const viaGroup = selectionMatcher({ ...value, userIds: [], excludedUserIds: [] }, (b) => districtOfBranch.get(b));
      const groupIds = new Set(dir.users.filter((u) => ids.has(u.id) && viaGroup(u)).map((u) => u.id));
      const userIds = value.userIds.filter((x) => !ids.has(x));
      const excluded = (value.excludedUserIds ?? []).filter((x) => !ids.has(x));
      if (on) set({ userIds: [...userIds, ...[...ids].filter((x) => !groupIds.has(x))], excludedUserIds: excluded });
      else set({ userIds, excludedUserIds: [...excluded, ...groupIds] });
      return;
    }
    const k = key[tab];
    const ids = shown.map((i) => i.id);
    const list = on ? [...new Set([...value[k], ...ids])] : value[k].filter((x) => !ids.includes(x));
    const branchIds = tab === "districts" && !on ? value.branchIds.filter((b) => !ids.includes(districtOfBranch.get(b) ?? "")) : value.branchIds;
    set({ [k]: list, ...(tab === "districts" ? { branchIds } : {}) });
  }

  const allShownTicked = shown.length > 0 && shown.every((i) => isTicked(tab, i.id));
  const nameOf = (t: Exclude<Tab, "people">, id: string) => lists[t].find((i) => i.id === id)?.label ?? dir.branches.find((b) => b.id === id)?.name ?? id;
  const summary: { t: Tab; label: string; ids: string[]; names: string[] }[] = [
    { t: "roles", label: "Roles", ids: value.roleCodes, names: value.roleCodes.map((id) => nameOf("roles", id)) },
    { t: "districts", label: "Districts", ids: value.districtIds, names: value.districtIds.map((id) => nameOf("districts", id)) },
    { t: "branches", label: "Branches", ids: value.branchIds, names: value.branchIds.map((id) => nameOf("branches", id)) },
    { t: "people", label: "Also", ids: value.userIds, names: value.userIds.map((id) => dir.users.find((u) => u.id === id)?.name ?? id) },
    { t: "people", label: "Except", ids: value.excludedUserIds ?? [], names: (value.excludedUserIds ?? []).map((id) => dir.users.find((u) => u.id === id)?.name ?? id) },
  ];

  // The reach list, grouped by branch (or district / Head Office).
  const grouped = useMemo(() => {
    const m = new Map<string, DirectoryUser[]>();
    for (const u of reached) {
      const g = u.branchName ?? u.districtName ?? "Head Office";
      m.set(g, [...(m.get(g) ?? []), u]);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [reached]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-4 text-sm text-slate-700">
        <label className="flex items-center gap-2">
          <input type="radio" name="comm-to" checked={value.toAll} onChange={() => set({ toAll: true })} className="h-4 w-4" />
          Everyone ({dir.users.length})
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="comm-to" checked={!value.toAll} onChange={() => set({ toAll: false })} className="h-4 w-4" />
          Choose
        </label>
      </div>

      {!value.toAll && (
        <div className="rounded-md border border-slate-200">
          <div role="tablist" className="flex flex-wrap border-b border-slate-200 bg-slate-50">
            {TABS.map(({ id, label, Icon }) => {
              const n = id === "people" ? value.userIds.length + (value.excludedUserIds?.length ?? 0) : value[key[id]].length;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => {
                    setTab(id);
                    setFilter("");
                  }}
                  className={`flex items-center gap-1.5 px-3 py-2 text-sm ${tab === id ? "border-b-2 border-sky-600 font-medium text-sky-800" : "text-slate-600 hover:text-slate-900"}`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                  {n > 0 && <span className="rounded-full bg-sky-100 px-1.5 text-xs text-sky-800">{n}</span>}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 p-2">
            <Input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={`Filter ${TABS.find((t) => t.id === tab)!.label.toLowerCase()}…`}
              aria-label={`Filter ${tab}`}
              className="min-w-0 flex-1"
            />
            <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-slate-600">
              <input type="checkbox" checked={allShownTicked} onChange={(e) => setAllShown(e.target.checked)} disabled={shown.length === 0} className="h-4 w-4 rounded border-slate-300" />
              Select all ({shown.length})
            </label>
          </div>
          {tab === "branches" && value.districtIds.length > 0 && (
            <p className="px-3 pb-1 text-xs text-slate-500">Branches of the ticked districts. Ticking branches sends to those branches only, not the whole district.</p>
          )}
          {tab === "people" && (
            <p className="px-3 pb-1 text-xs text-slate-500">Ticked = receives it. Untick someone to leave them out; tick anyone else to add them.</p>
          )}

          <ul className="max-h-64 overflow-y-auto border-t border-slate-100" aria-label={`${tab} list`}>
            {shown.length === 0 && <li className="px-3 py-4 text-center text-sm text-slate-500">Nothing matches.</li>}
            {shown.map((i) => (
              <li key={i.id}>
                <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50">
                  <input type="checkbox" checked={isTicked(tab, i.id)} onChange={(e) => toggle(tab, i.id, e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                  <span className="text-slate-900">{i.label}</span>
                  {i.detail && <span className="truncate text-xs text-slate-500">{i.detail}</span>}
                  {i.count !== undefined && <span className="ml-auto text-xs tabular-nums text-slate-500">{i.count}</span>}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!value.toAll && summary.some((s) => s.ids.length > 0) && (
        <div className="flex flex-col gap-1 text-xs">
          {summary
            .filter((s) => s.ids.length > 0)
            .map((s) => (
              <div key={s.label} className="flex flex-wrap items-center gap-1">
                <span className="font-medium text-slate-600">{s.label}:</span>
                {s.ids.map((id, idx) => (
                  <span key={id} className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-sky-900">
                    {s.names[idx]}
                    <button
                      type="button"
                      aria-label={`Remove ${s.names[idx]}`}
                      className="rounded-full p-0.5 hover:bg-sky-100"
                      onClick={() =>
                        s.label === "Also"
                          ? set({ userIds: value.userIds.filter((x) => x !== id) })
                          : s.label === "Except"
                            ? set({ excludedUserIds: (value.excludedUserIds ?? []).filter((x) => x !== id) })
                            : toggle(s.t, id, false)
                      }
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            ))}
          {(value.roleCodes.length > 0 && value.districtIds.length + value.branchIds.length > 0) && (
            <p className="text-slate-500">Ticked roles in the ticked places only.</p>
          )}
        </div>
      )}

      <div className="text-xs text-slate-600">
        {reached.length === 0 ? (
          "Nobody chosen yet."
        ) : (
          <button type="button" onClick={() => setShowList((v) => !v)} className="inline-flex items-center gap-1 font-medium text-sky-800 hover:underline">
            → {reached.length} {reached.length === 1 ? "person" : "people"}
            {showList ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        )}
        <span className="ml-1 text-slate-500">Administrators never receive messages; inactive users are skipped.</span>
      </div>
      {showList && reached.length > 0 && (
        <div className="max-h-60 overflow-y-auto rounded-md border border-slate-200 p-2 text-xs">
          {grouped.map(([group, people]) => (
            <div key={group} className="mb-1.5">
              <p className="font-medium text-slate-700">
                {group} ({people.length})
              </p>
              <p className="text-slate-600">{people.map((u) => `${u.name} (${u.roleName})`).join(", ")}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
