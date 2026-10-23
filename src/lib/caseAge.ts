import { appNow } from "@/lib/clock";
import type { Database, Finding, FindingTransition } from "@/types";

/**
 * Case age (docs/case-age.md) - whole days a finding has been open, three ways:
 *
 * - submit:      from its FIRST submission (a draft has none yet).
 * - approved:    from the first time it reached Sent to Branch Manager, i.e.
 *                final approval (none while in review / returned / rejected).
 * - findingDate: from the Finding date on the form (00:00 that day).
 *
 * Imported findings are submitted and approved in the same moment (the
 * import), so `imported` is true and submit === approved. Transfers never
 * reset an age. A finding that is closed now stops ageing at its close date.
 * Ages are never negative (a future Finding date shows 0).
 */
export interface CaseAges {
  submit: number | null;
  approved: number | null;
  findingDate: number | null;
  /** Imported: one age covers submit and approved. */
  imported: boolean;
  /** No SUBMIT in the history (older data): submit / approved counted from registration. */
  estimated: boolean;
}

interface Moments {
  submitAt: number | null;
  approvedAt: number | null;
  closedAt: number | null;
  imported: boolean;
  estimated: boolean;
}

const DAY = 86_400_000;
const SUBMIT_ACTIONS = new Set(["SUBMIT", "IMPORT_SUBMIT"]);

function momentsOf(f: Finding, history: FindingTransition[]): Moments {
  const sorted = [...history].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const submit = sorted.find((t) => SUBMIT_ACTIONS.has(t.action));
  const approved = sorted.find((t) => t.toStatus === "SENT_TO_BRANCH_MANAGER");
  const closed = f.status === "CLOSED" ? [...sorted].reverse().find((t) => t.toStatus === "CLOSED") : undefined;
  const at = (t?: FindingTransition) => (t ? new Date(t.createdAt).getTime() : null);
  // Older data with no SUBMIT on record, but already past it: registration stands in.
  const pastSubmit = !["DRAFT"].includes(f.status);
  const estimated = !submit && pastSubmit;
  return {
    submitAt: at(submit) ?? (estimated ? new Date(f.createdAt).getTime() : null),
    approvedAt: at(approved) ?? (estimated && approvedStatus(f) ? new Date(f.createdAt).getTime() : null),
    closedAt: at(closed) ?? (f.status === "CLOSED" ? new Date(f.updatedAt).getTime() : null),
    imported: Boolean(f.importBatchId) || sorted.some((t) => t.action === "IMPORT_SUBMIT"),
    estimated,
  };
}

/** Statuses a finding only reaches after final approval. */
function approvedStatus(f: Finding): boolean {
  return ["SENT_TO_BRANCH_MANAGER", "PARTIALLY_RECTIFIED", "RECTIFIED", "RECTIFICATION_RETURNED", "TRANSFERRED", "REVERSED", "CLOSED"].includes(f.status);
}

function findingDateMs(f: Finding): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(f.findingDate ?? "");
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : null;
}

function agesFrom(f: Finding, m: Moments, asOf: number): CaseAges {
  // A closed finding stops ageing at its close (unless asked about an earlier moment).
  const end = m.closedAt !== null ? Math.min(asOf, m.closedAt) : asOf;
  const days = (from: number | null) => (from === null ? null : Math.max(0, Math.floor((end - from) / DAY)));
  const imported = m.imported;
  return {
    submit: days(m.submitAt),
    approved: days(imported ? (m.approvedAt ?? m.submitAt) : m.approvedAt),
    findingDate: days(findingDateMs(f)),
    imported,
    estimated: m.estimated,
  };
}

/**
 * A finding's ages, as of now (or `asOf`, e.g. a transfer's time - "age at
 * transfer"). `history` = the finding's own transitions.
 */
export function caseAges(f: Finding, history: FindingTransition[], asOf: number = appNow()): CaseAges {
  return agesFrom(f, momentsOf(f, history), asOf);
}

/**
 * For many findings at once (lists, dashboards, reports): groups the history
 * once, then ages(f, asOf?) per finding.
 */
export function caseAgeIndex(db: Pick<Database, "findingTransitions">): (f: Finding, asOf?: number) => CaseAges {
  const byFinding = new Map<string, FindingTransition[]>();
  for (const t of db.findingTransitions ?? []) {
    const list = byFinding.get(t.findingId);
    if (list) list.push(t);
    else byFinding.set(t.findingId, [t]);
  }
  const cache = new Map<string, Moments>();
  return (f, asOf = appNow()) => {
    let m = cache.get(f.id);
    if (!m) {
      m = momentsOf(f, byFinding.get(f.id) ?? []);
      cache.set(f.id, m);
    }
    return agesFrom(f, m, asOf);
  };
}

/** Average Case age (approved) of these findings, whole days; null for none. */
export function averageApprovedAge(db: Pick<Database, "findingTransitions">, findings: Finding[]): number | null {
  const ages = caseAgeIndex(db);
  const values = findings.map((f) => ages(f).approved).filter((a): a is number => a !== null);
  if (values.length === 0) return null;
  return Math.round(values.reduce((s, a) => s + a, 0) / values.length);
}

/** "12 days" / "1 day" / "—". */
export function formatAge(days: number | null): string {
  return days === null ? "—" : `${days} day${days === 1 ? "" : "s"}`;
}

/**
 * One line for a finding's ages: "Submit 12d · Approved 10d · Finding date 40d",
 * or for an import "Submit / approved 3d · Finding date 400d".
 */
export function ageSummary(a: CaseAges): string {
  const d = (n: number | null) => (n === null ? "—" : `${n}d`);
  const head = a.imported ? `Submit / approved ${d(a.approved)}` : `Submit ${d(a.submit)} · Approved ${d(a.approved)}`;
  return `${head} · Finding date ${d(a.findingDate)}${a.estimated ? " (est.)" : ""}`;
}
