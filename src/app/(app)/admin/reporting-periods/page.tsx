"use client";

import { useEffect, useMemo, useState } from "react";
import type { MRT_ColumnDef } from "material-react-table";
import { apiGet, apiSend, errorMessage } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StickyActions } from "@/components/ui/StickyActions";
import { Input, Label } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Tag } from "lucide-react";
import { AddDialog } from "@/components/ui/AddDialog";
import { RowAction, RowActions } from "@/components/ui/RowActions";
import { usePermissions } from "@/lib/permissions/PermissionsContext";
import { hasPermission } from "@/lib/permissions/registry";
import type { ReportingPeriod } from "@/types";
import { AdminTable } from "@/components/ui/AdminTable";
import { notify, notifications } from "@/lib/notify";

// The GET route annotates each period with a live transfer preview (see
// outstandingTransferPreview() in src/lib/findings.ts) so the Lock dialog
// can ask an informed question instead of a blind checkbox.
type PeriodWithTransferPreview = ReportingPeriod & {
  outstandingTransferableCount: number;
  transferDestinationCode: string | null;
  // Lets "Edit Period" (its own date range) disable itself once anything
  // references it - see the PATCH route's own comment for why that's the
  // line drawn (reference numbers/dedupe keys/every period-scoped stat
  // already keyed off the current dates).
  findingCount: number;
};

function startOfMonthLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01T00:00`;
}
function endOfMonthLocal(d: Date): string {
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59);
  const y = end.getFullYear();
  const m = String(end.getMonth() + 1).padStart(2, "0");
  const day = String(end.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}T23:59`;
}
// Same local-time convention as startOfMonthLocal/endOfMonthLocal above,
// just starting from an existing ISO timestamp (a period's own
// submissionStartsAt/submissionEndsAt) instead of "now" - what a
// <input type="datetime-local"> needs as its value.
function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${mo}-${day}T${h}:${mi}`;
}

export default function ReportingPeriodsPage() {
  const [periods, setPeriods] = useState<PeriodWithTransferPreview[]>([]);
  const [autoTransferAllowed, setAutoTransferAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const now = new Date();
  // submissionStartsAt/submissionEndsAt default to exactly the period's
  // own range - most admins never touch them. handleStartsAtChange/
  // handleEndsAtChange below keep them "shadowing" the period's own dates
  // until the admin explicitly edits one, at which point it stops
  // following along (same pattern a spreadsheet's "linked cell" uses).
  const [form, setForm] = useState({
    startsAt: startOfMonthLocal(now),
    endsAt: endOfMonthLocal(now),
    submissionStartsAt: startOfMonthLocal(now),
    submissionEndsAt: endOfMonthLocal(now),
    name: "",
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  const permissions = usePermissions();
  const canCreate = hasPermission(permissions, "reporting-periods.create");
  // "Edit Period"/Rename/submission-window Edit/Lock-flags-only-Edit all
  // PATCH through the same route, which requires reporting-periods.lock
  // for every kind of update (there's no separate "edit" action in the
  // registry for this page) - gated identically to Lock/Unlock itself.
  const canLock = hasPermission(permissions, "reporting-periods.lock");
  const canDelete = hasPermission(permissions, "reporting-periods.delete");

  function handleStartsAtChange(value: string) {
    setForm((f) => ({ ...f, startsAt: value, submissionStartsAt: f.submissionStartsAt === f.startsAt ? value : f.submissionStartsAt }));
  }
  function handleEndsAtChange(value: string) {
    setForm((f) => ({ ...f, endsAt: value, submissionEndsAt: f.submissionEndsAt === f.endsAt ? value : f.submissionEndsAt }));
  }

  // Editing an existing period's submission window - independent of
  // lock/unlock, so it gets its own small dialog rather than overloading
  // the Lock dialog's already-specific purpose.
  const [windowTarget, setWindowTarget] = useState<PeriodWithTransferPreview | null>(null);
  const [windowForm, setWindowForm] = useState({ submissionStartsAt: "", submissionEndsAt: "" });
  const [windowReason, setWindowReason] = useState("");
  const [windowError, setWindowError] = useState<string | null>(null);
  const [windowBusy, setWindowBusy] = useState(false);

  function openWindowDialog(p: PeriodWithTransferPreview) {
    setWindowForm({ submissionStartsAt: toDatetimeLocal(p.submissionStartsAt), submissionEndsAt: toDatetimeLocal(p.submissionEndsAt) });
    setWindowReason("");
    setWindowError(null);
    setWindowTarget(p);
  }

  async function confirmWindow() {
    if (!windowTarget) return;
    setWindowError(null);
    setWindowBusy(true);
    try {
      await apiSend(`/api/admin/reporting-periods/${windowTarget.id}`, "PATCH", {
        submissionStartsAt: windowForm.submissionStartsAt,
        submissionEndsAt: windowForm.submissionEndsAt,
        reason: windowReason,
      });
      notify.success(notifications.reportingPeriod.windowUpdated);
      setWindowTarget(null);
      await load();
    } catch (err) {
      setWindowError(errorMessage(err, "Failed to update submission window"));
    } finally {
      setWindowBusy(false);
    }
  }

  // Editing the period's own date range - only ever offered when
  // findingCount is 0 (see the type's own comment); a distinct dialog from
  // the submission-window one above since the precondition differs.
  const [periodEditTarget, setPeriodEditTarget] = useState<PeriodWithTransferPreview | null>(null);
  const [periodEditForm, setPeriodEditForm] = useState({ startsAt: "", endsAt: "", submissionStartsAt: "", submissionEndsAt: "" });
  const [periodEditReason, setPeriodEditReason] = useState("");
  const [periodEditError, setPeriodEditError] = useState<string | null>(null);
  const [periodEditBusy, setPeriodEditBusy] = useState(false);

  // Renaming has none of the date-range safety concerns Edit Period has
  // (see that dialog's own comment), so it's always available regardless
  // of findingCount - a simple inline input rather than a full dialog.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameReason, setRenameReason] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);

  function openRename(p: PeriodWithTransferPreview) {
    setRenamingId(p.id);
    setRenameValue(p.name ?? "");
    setRenameReason("");
    setRenameError(null);
  }

  async function saveRename(p: PeriodWithTransferPreview) {
    if (renameReason.trim().length < 5) {
      setRenameError("A reason of at least 5 characters is required");
      return;
    }
    setRenameBusy(true);
    setRenameError(null);
    try {
      await apiSend(`/api/admin/reporting-periods/${p.id}`, "PATCH", { name: renameValue, reason: renameReason });
      notify.success(notifications.reportingPeriod.updated);
      setRenamingId(null);
      await load();
    } catch (err) {
      setRenameError(errorMessage(err, "Failed to rename period"));
    } finally {
      setRenameBusy(false);
    }
  }

  function openPeriodEditDialog(p: PeriodWithTransferPreview) {
    setPeriodEditForm({
      startsAt: toDatetimeLocal(p.startsAt),
      endsAt: toDatetimeLocal(p.endsAt),
      submissionStartsAt: toDatetimeLocal(p.submissionStartsAt),
      submissionEndsAt: toDatetimeLocal(p.submissionEndsAt),
    });
    setPeriodEditReason("");
    setPeriodEditError(null);
    setPeriodEditTarget(p);
  }

  function handlePeriodEditStartsAtChange(value: string) {
    setPeriodEditForm((f) => ({
      ...f,
      startsAt: value,
      submissionStartsAt: f.submissionStartsAt === f.startsAt ? value : f.submissionStartsAt,
    }));
  }
  function handlePeriodEditEndsAtChange(value: string) {
    setPeriodEditForm((f) => ({
      ...f,
      endsAt: value,
      submissionEndsAt: f.submissionEndsAt === f.endsAt ? value : f.submissionEndsAt,
    }));
  }

  async function confirmPeriodEdit() {
    if (!periodEditTarget) return;
    setPeriodEditError(null);
    setPeriodEditBusy(true);
    try {
      await apiSend(`/api/admin/reporting-periods/${periodEditTarget.id}`, "PATCH", {
        startsAt: periodEditForm.startsAt,
        endsAt: periodEditForm.endsAt,
        submissionStartsAt: periodEditForm.submissionStartsAt,
        submissionEndsAt: periodEditForm.submissionEndsAt,
        reason: periodEditReason,
      });
      notify.success(notifications.reportingPeriod.updated);
      setPeriodEditTarget(null);
      await load();
    } catch (err) {
      setPeriodEditError(errorMessage(err, "Failed to update period dates"));
    } finally {
      setPeriodEditBusy(false);
    }
  }

  // Locking needs more input (the drafts-while-locked checkbox, and the
  // transfer-overdue-cases prompt) than the generic reason-only
  // useConfirm() dialog supports, so it gets its own small inline dialog
  // rather than widening that shared component's contract for every other
  // admin page that reuses it.
  const [lockTarget, setLockTarget] = useState<PeriodWithTransferPreview | null>(null);
  const [lockReasonInput, setLockReasonInput] = useState("");
  const [lockDraftsAllowed, setLockDraftsAllowed] = useState(true);
  const [lockTransferOverdue, setLockTransferOverdue] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);

  async function load() {
    setLoading(true);
    const res = await apiGet<{ reportingPeriods: PeriodWithTransferPreview[]; autoTransferOnLock: boolean }>(
      "/api/admin/reporting-periods"
    );
    setPeriods(res.reportingPeriods);
    setAutoTransferAllowed(res.autoTransferOnLock);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: React.FormEvent, close: () => void) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await apiSend("/api/admin/reporting-periods", "POST", form);
      notify.success(notifications.reportingPeriod.created);
      setForm((f) => ({ ...f, name: "" }));
      close();
      await load();
    } catch (err) {
      setFormError(errorMessage(err, "Failed to create reporting period"));
    } finally {
      setSubmitting(false);
    }
  }

  function openLockDialog(p: PeriodWithTransferPreview) {
    setLockDraftsAllowed(p.draftsAllowedWhileLocked);
    // Default to "yes, transfer" only when locking (not a flag-only edit
    // on an already-LOCKED period), the Admin allows it at all, and
    // there's actually something to transfer into somewhere - otherwise
    // there's nothing meaningful to default to yes on.
    setLockTransferOverdue(p.status === "OPEN" && autoTransferAllowed && p.outstandingTransferableCount > 0 && p.transferDestinationCode !== null);
    setLockReasonInput("");
    setLockTarget(p);
  }

  async function toggleLock(p: PeriodWithTransferPreview) {
    if (p.status === "OPEN") {
      openLockDialog(p);
      return;
    }
    // Unlocking doesn't touch draftsAllowedWhileLocked - it's only
    // meaningful while LOCKED - so it keeps using the generic dialog.
    const reason = await confirm({
      title: `Unlock ${p.code}?`,
      message: `Unlocking reopens ${p.code} for new writes bank-wide.`,
      confirmLabel: "Unlock",
      tone: "danger",
      needsReason: true,
    });
    if (reason === false) return;
    setRowBusy(p.id);
    try {
      await apiSend(`/api/admin/reporting-periods/${p.id}`, "PATCH", { status: "OPEN", reason });
      notify.success(notifications.reportingPeriod.unlocked);
      await load();
    } catch (err) {
      notify.fromError(err, notifications.reportingPeriod.lockFailed);
    } finally {
      setRowBusy(null);
    }
  }

  async function deletePeriod(p: PeriodWithTransferPreview) {
    const result = await confirm({
      title: `Permanently delete ${p.code}?`,
      message: `This removes ${p.code} entirely - unlike locking, this cannot be undone. Only allowed if nothing (findings, scoring adjustments, rectifications, closures, or transfers) references it.`,
      confirmLabel: "Delete Permanently",
      tone: "danger",
    });
    if (result === false) return;
    setRowBusy(p.id);
    try {
      await apiSend(`/api/admin/reporting-periods/${p.id}`, "DELETE");
      notify.success(notifications.reportingPeriod.deleted);
      await load();
    } catch (err) {
      notify.fromError(err, notifications.reportingPeriod.deleteFailed);
    } finally {
      setRowBusy(null);
    }
  }

  // True when adjusting drafts-while-locked on a period that's already
  // LOCKED (no status change), rather than locking a currently-OPEN one -
  // the same dialog serves both, just with different copy/payload.
  const isFlagEditOnly = lockTarget?.status === "LOCKED";

  async function confirmLock() {
    if (!lockTarget) return;
    setLockBusy(true);
    try {
      await apiSend(`/api/admin/reporting-periods/${lockTarget.id}`, "PATCH", {
        ...(isFlagEditOnly ? {} : { status: "LOCKED", transferOverdueCases: lockTransferOverdue }),
        reason: lockReasonInput,
        draftsAllowedWhileLocked: lockDraftsAllowed,
      });
      notify.success(isFlagEditOnly ? notifications.reportingPeriod.updated : notifications.reportingPeriod.locked);
      setLockTarget(null);
      await load();
    } catch (err) {
      notify.fromError(err, notifications.reportingPeriod.lockFailed);
    } finally {
      setLockBusy(false);
    }
  }

  const columns = useMemo<MRT_ColumnDef<PeriodWithTransferPreview>[]>(
    () => [
      {
        accessorKey: "code",
        header: "Period",
        meta: { exportValue: (p: PeriodWithTransferPreview) => (p.name ? `${p.code} (${p.name})` : p.code) },
        Cell: ({ row }) => {
          const p = row.original;
          return (
            <div className="font-medium text-slate-900">
              {p.code}
              {renamingId === p.id ? (
                <div className="mt-1 flex flex-col gap-1">
                  <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} placeholder="e.g. September 2026 Monthly Review" className="max-w-56 text-xs" />
                  <Input value={renameReason} onChange={(e) => setRenameReason(e.target.value)} placeholder="Reason (required, 5+ chars)" className="max-w-56 text-xs" />
                  {renameError && <p className="text-xs text-red-600">{renameError}</p>}
                  <div className="flex gap-1.5">
                    <RowAction kind="cancel" onClick={() => setRenamingId(null)} disabled={renameBusy} />
                    <RowAction kind="save" busy={renameBusy} label={renameBusy ? "Saving..." : "Save"} onClick={() => saveRename(p)} />
                  </div>
                </div>
              ) : (
                p.name && <div className="mt-0.5 text-xs font-normal text-slate-500">{p.name}</div>
              )}
            </div>
          );
        },
      },
      {
        id: "range",
        header: "Date/Time Range",
        accessorFn: (p) => p.startsAt,
        meta: { exportValue: (p: PeriodWithTransferPreview) => `${formatDateTime(p.startsAt)} - ${formatDateTime(p.endsAt)}` },
        Cell: ({ row }) => {
          const p = row.original;
          return (
            <div className="text-xs text-slate-500">
              {formatDateTime(p.startsAt)} — {formatDateTime(p.endsAt)}
              <div className="mt-0.5">
                Submissions: {formatDateTime(p.submissionStartsAt)} – {formatDateTime(p.submissionEndsAt)}{" "}
                {canLock && (
                  <button type="button" onClick={() => openWindowDialog(p)} className="text-blue-800 hover:underline">
                    Edit
                  </button>
                )}
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "status",
        header: "Status",
        filterVariant: "select",
        filterSelectOptions: ["OPEN", "LOCKED"],
        meta: {
          exportValue: (p: PeriodWithTransferPreview) =>
            p.status === "LOCKED" ? `LOCKED (${p.draftsAllowedWhileLocked ? "drafts allowed" : "drafts blocked"})` : p.status,
        },
        Cell: ({ row }) => {
          const p = row.original;
          return (
            <>
              <Badge tone={p.status === "OPEN" ? "green" : "red"}>{p.status}</Badge>
              {p.status === "LOCKED" && (
                <>
                  <Badge tone={p.draftsAllowedWhileLocked ? "blue" : "gray"} className="ml-1">
                    {p.draftsAllowedWhileLocked ? "Drafts allowed" : "Drafts blocked"}
                  </Badge>
                  {canLock && (
                    <button type="button" onClick={() => openLockDialog(p)} className="ml-1.5 text-xs text-blue-800 hover:underline">
                      Edit
                    </button>
                  )}
                </>
              )}
            </>
          );
        },
      },
      { accessorKey: "findingCount", header: "Findings", size: 90 },
      {
        id: "lastChange",
        header: "Last Change",
        accessorFn: (p) => (p.lockReason ? `${p.lockReason} · ${formatDateTime(p.updatedAt)}` : ""),
        Cell: ({ cell }) => <span className="text-xs text-slate-500">{cell.getValue<string>() || "—"}</span>,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [renamingId, renameValue, renameReason, renameError, renameBusy, canLock]
  );

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Reporting Periods</h1>
      <p className="mt-1 text-sm text-slate-600">
        Locking a period blocks new writes against it, except DRAFT findings when explicitly allowed. Lock/unlock
        always requires a reason and is audit-logged.
      </p>

      <Card className="mt-5">
        <CardHeader title="All Periods" description={`${periods.length} total`}
          action={canCreate && (
            <AddDialog
              title="Open a New Period"
              description="Created LOCKED by default (drafts still allowed) - use Unlock below to open it for the full workflow."
            >
              {({ close }) => (
              <>
              <form onSubmit={(e) => handleCreate(e, close)} className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3 sm:items-end">
                <div>
                  <Label htmlFor="startsAt">Starts at (date &amp; time)</Label>
                  <Input id="startsAt" type="datetime-local" value={form.startsAt} onChange={(e) => handleStartsAtChange(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="endsAt">Ends at (date &amp; time)</Label>
                  <Input id="endsAt" type="datetime-local" value={form.endsAt} onChange={(e) => handleEndsAtChange(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="name">Name (optional)</Label>
                  <Input
                    id="name"
                    placeholder="e.g. September 2026 Monthly Review"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="submissionStartsAt">Submission window starts at</Label>
                  <Input
                    id="submissionStartsAt"
                    type="datetime-local"
                    value={form.submissionStartsAt}
                    onChange={(e) => setForm({ ...form, submissionStartsAt: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="submissionEndsAt">Submission window ends at</Label>
                  <Input
                    id="submissionEndsAt"
                    type="datetime-local"
                    value={form.submissionEndsAt}
                    onChange={(e) => setForm({ ...form, submissionEndsAt: e.target.value })}
                  />
                </div>
                <StickyActions error={formError}>
                  <Button type="button" variant="cancel" onClick={close}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? "Creating..." : "Create Period"}
                  </Button>
                </StickyActions>
              </form>
              <p className="px-4 pb-4 text-xs text-slate-500">
                The submission window is when a finding can actually be submitted (moved past draft) - narrower than, and
                inside, the period&apos;s own date range above. Defaults to matching it exactly; narrow it only if new
                findings should stop being submittable partway through the period (e.g. the period covers all of
                September, but branches should only submit in the first two weeks).
              </p>
              </>
              )}
            </AddDialog>
          )}
        />
        <AdminTable
          columns={columns}
          data={periods}
          isLoading={loading}
          getRowId={(p) => p.id}
          exportFileName="reporting-periods"
          emptyText="No reporting periods yet."
          renderRowActions={(p) => (
            <RowActions>
              {canLock && (
                <RowAction
                  kind="edit"
                  label="Edit period"
                  disabled={p.findingCount > 0}
                  title={
                    p.findingCount > 0
                      ? `Can't change this period's date range - ${p.findingCount} finding(s) already reference it`
                      : "Edit this period's date range"
                  }
                  onClick={() => openPeriodEditDialog(p)}
                />
              )}
              {canLock && renamingId !== p.id && (
                <RowAction kind="edit" icon={Tag} label={p.name ? "Rename" : "Add name"} onClick={() => openRename(p)} />
              )}
              {canLock && <RowAction kind={p.status === "OPEN" ? "lock" : "unlock"} busy={rowBusy === p.id} onClick={() => toggleLock(p)} />}
              {canDelete && (
                <RowAction
                  kind="delete"
                  busy={rowBusy === p.id}
                  disabled={p.findingCount > 0}
                  title={p.findingCount > 0 ? `${p.findingCount} finding(s) reference this period` : "Delete"}
                  onClick={() => deletePeriod(p)}
                />
              )}
            </RowActions>
          )}
        />
      </Card>
      {dialog}

      {lockTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-sm font-semibold text-slate-900">
              {isFlagEditOnly ? `Update drafts setting for ${lockTarget.code}` : `Lock ${lockTarget.code}?`}
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              {isFlagEditOnly
                ? `${lockTarget.code} stays LOCKED - this only changes whether DRAFT findings can still be created/edited against it.`
                : `Locking blocks new writes against ${lockTarget.code} bank-wide, except explicitly authorized exceptions. This can be reversed by unlocking.`}
            </p>
            <div className="mt-3">
              <Label htmlFor="lock-reason">Reason</Label>
              <Input id="lock-reason" autoFocus value={lockReasonInput} onChange={(e) => setLockReasonInput(e.target.value)} />
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={lockDraftsAllowed}
                onChange={(e) => setLockDraftsAllowed(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              Allow findings to still be drafted while locked
            </label>
            {!isFlagEditOnly && autoTransferAllowed && lockTarget.outstandingTransferableCount > 0 && (
              <>
                {lockTarget.transferDestinationCode ? (
                  <label className="mt-3 flex items-start gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={lockTransferOverdue}
                      onChange={(e) => setLockTransferOverdue(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300"
                    />
                    <span>
                      Transfer {lockTarget.outstandingTransferableCount} outstanding case
                      {lockTarget.outstandingTransferableCount === 1 ? "" : "s"} to {lockTarget.transferDestinationCode}?
                    </span>
                  </label>
                ) : (
                  <p className="mt-3 text-xs text-amber-700">
                    {lockTarget.outstandingTransferableCount} outstanding case
                    {lockTarget.outstandingTransferableCount === 1 ? "" : "s"} in {lockTarget.code}, but there&apos;s no open
                    period after it to transfer into - open a later period first if you want to transfer them.
                  </p>
                )}
              </>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="cancel" onClick={() => setLockTarget(null)}>
                Cancel
              </Button>
              <Button variant="danger" disabled={lockBusy || lockReasonInput.trim().length < 5} onClick={confirmLock}>
                {lockBusy ? "Saving..." : isFlagEditOnly ? "Save" : "Lock"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {windowTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-sm font-semibold text-slate-900">Edit submission window for {windowTarget.code}</h2>
            <p className="mt-2 text-sm text-slate-600">
              Must fall within the period&apos;s own range ({formatDateTime(windowTarget.startsAt)} —{" "}
              {formatDateTime(windowTarget.endsAt)}). Doesn&apos;t affect lock status or draft-saving.
            </p>
            <div className="mt-3">
              <Label htmlFor="window-starts">Submission window starts at</Label>
              <Input
                id="window-starts"
                type="datetime-local"
                value={windowForm.submissionStartsAt}
                onChange={(e) => setWindowForm({ ...windowForm, submissionStartsAt: e.target.value })}
              />
            </div>
            <div className="mt-3">
              <Label htmlFor="window-ends">Submission window ends at</Label>
              <Input
                id="window-ends"
                type="datetime-local"
                value={windowForm.submissionEndsAt}
                onChange={(e) => setWindowForm({ ...windowForm, submissionEndsAt: e.target.value })}
              />
            </div>
            <div className="mt-3">
              <Label htmlFor="window-reason">Reason</Label>
              <Input id="window-reason" autoFocus value={windowReason} onChange={(e) => setWindowReason(e.target.value)} />
            </div>
            {windowError && <p className="mt-2 text-sm text-red-600">{windowError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="cancel" onClick={() => setWindowTarget(null)}>
                Cancel
              </Button>
              <Button disabled={windowBusy || windowReason.trim().length < 5} onClick={confirmWindow}>
                {windowBusy ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {periodEditTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-sm font-semibold text-slate-900">Edit {periodEditTarget.code}&apos;s date range</h2>
            <p className="mt-2 text-sm text-slate-600">
              Only possible because nothing references {periodEditTarget.code} yet. Changing the start date may change
              this period&apos;s code (e.g. moving it into a different month).
            </p>
            <div className="mt-3">
              <Label htmlFor="period-edit-starts">Starts at (date &amp; time)</Label>
              <Input
                id="period-edit-starts"
                type="datetime-local"
                value={periodEditForm.startsAt}
                onChange={(e) => handlePeriodEditStartsAtChange(e.target.value)}
              />
            </div>
            <div className="mt-3">
              <Label htmlFor="period-edit-ends">Ends at (date &amp; time)</Label>
              <Input
                id="period-edit-ends"
                type="datetime-local"
                value={periodEditForm.endsAt}
                onChange={(e) => handlePeriodEditEndsAtChange(e.target.value)}
              />
            </div>
            <div className="mt-3">
              <Label htmlFor="period-edit-sub-starts">Submission window starts at</Label>
              <Input
                id="period-edit-sub-starts"
                type="datetime-local"
                value={periodEditForm.submissionStartsAt}
                onChange={(e) => setPeriodEditForm({ ...periodEditForm, submissionStartsAt: e.target.value })}
              />
            </div>
            <div className="mt-3">
              <Label htmlFor="period-edit-sub-ends">Submission window ends at</Label>
              <Input
                id="period-edit-sub-ends"
                type="datetime-local"
                value={periodEditForm.submissionEndsAt}
                onChange={(e) => setPeriodEditForm({ ...periodEditForm, submissionEndsAt: e.target.value })}
              />
            </div>
            <div className="mt-3">
              <Label htmlFor="period-edit-reason">Reason</Label>
              <Input id="period-edit-reason" autoFocus value={periodEditReason} onChange={(e) => setPeriodEditReason(e.target.value)} />
            </div>
            {periodEditError && <p className="mt-2 text-sm text-red-600">{periodEditError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="cancel" onClick={() => setPeriodEditTarget(null)}>
                Cancel
              </Button>
              <Button disabled={periodEditBusy || periodEditReason.trim().length < 5} onClick={confirmPeriodEdit}>
                {periodEditBusy ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
