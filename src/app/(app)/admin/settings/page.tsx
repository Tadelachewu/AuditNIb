"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiSend, ApiError } from "@/lib/api-client";
import { CollapsibleCard } from "@/components/ui/CollapsibleCard";
import { Button } from "@/components/ui/Button";
import { StickyActions } from "@/components/ui/StickyActions";
import { Input, Select, Label } from "@/components/ui/Field";
import { SettingsListEditor } from "@/components/admin/SettingsListEditor";
import { REPORT_TEMPLATES } from "@/lib/reportTemplateMeta";
import { SIMILAR_FINDING_FIELDS, REQUIRABLE_FINDING_FIELDS, OTHER_VALUE_ALLOWED_FIELDS } from "@/types";
import { usePermissions } from "@/lib/permissions/PermissionsContext";
import { hasPermission } from "@/lib/permissions/registry";
import type { Settings, SafeUser, Source } from "@/types";
import { FormSkeleton } from "@/components/ui/Skeleton";
import {
  DEFAULT_TYPOGRAPHY,
  FONT_GROUPS,
  FONT_OPTIONS,
  TEXT_SIZE_OPTIONS,
  TEXT_CONTRAST_OPTIONS,
  CHROME_OPTIONS,
  CHROME_GROUPS,
  chromeStyle,
  isDefaultTypography,
  fontStack,
  normalizeTypography,
  type Typography,
} from "@/lib/typography";

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [bankUsers, setBankUsers] = useState<SafeUser[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [testEmailSending, setTestEmailSending] = useState(false);
  const [testEmailResult, setTestEmailResult] = useState<{ ok: boolean; message: string } | null>(null);
  const router = useRouter();
  const permissions = usePermissions();
  const canEdit = hasPermission(permissions, "settings.edit");

  useEffect(() => {
    // reportTemplateSources is a newer column - a server still running an
    // older Prisma client (or a row predating the migration) returns it
    // missing, so default it here rather than crash the render below.
    apiGet<{ settings: Settings }>("/api/admin/settings").then(({ settings }) =>
      setSettings({ ...settings, reportTemplateSources: settings.reportTemplateSources ?? {} })
    );
    // Every active BANK-scoped user (ADMIN/HO Controller/Executive holders)
    // - the only pool a hoApproval approver can be picked from, enforced
    // again server-side in the PATCH route.
    apiGet<{ users: SafeUser[] }>("/api/admin/users?orgScope=BANK").then(({ users }) => setBankUsers(users));
    apiGet<{ sources: Source[] }>("/api/admin/sources").then(({ sources }) => setSources(sources));
  }, []);

  function updateList(key: keyof Pick<Settings, "currencies" | "riskLevels" | "operationAreas" | "priorityLevels" | "irregularityTypes">, items: string[]) {
    setSettings((s) => (s ? { ...s, [key]: items } : s));
  }

  async function handleSave() {
    if (!settings) return;
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const payload = {
        currencies: settings.currencies,
        riskLevels: settings.riskLevels,
        operationAreas: settings.operationAreas,
        priorityLevels: settings.priorityLevels,
        irregularityTypes: settings.irregularityTypes,
        notification: settings.notification,
        autoTransferOnLock: settings.autoTransferOnLock,
        rankingVisibility: settings.rankingVisibility,
        rectificationReminders: settings.rectificationReminders,
        performanceThresholds: settings.performanceThresholds,
        hoApproval: settings.hoApproval,
        similarFindingFields: settings.similarFindingFields,
        requiredFindingFields: settings.requiredFindingFields,
        allowOtherValueFields: settings.allowOtherValueFields,
        reportTemplateSources: settings.reportTemplateSources ?? {},
        typography: normalizeTypography(settings.typography),
      };
      const res = await apiSend<{ settings: Settings }>("/api/admin/settings", "PATCH", payload);
      setSettings({ ...res.settings, reportTemplateSources: res.settings.reportTemplateSources ?? {} });
      setSaved(true);
      // Re-renders (app)/layout.tsx so a Typography change applies to the
      // whole app immediately, not just after the next navigation.
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  async function handleTestEmail() {
    setTestEmailResult(null);
    setTestEmailSending(true);
    try {
      const res = await apiSend<{ ok: boolean; sentTo: string }>("/api/admin/settings/test-email", "POST", {});
      setTestEmailResult({ ok: true, message: `Sent to ${res.sentTo}.` });
    } catch (err) {
      setTestEmailResult({ ok: false, message: err instanceof ApiError ? err.message : "Failed to send test email" });
    } finally {
      setTestEmailSending(false);
    }
  }

  if (!settings)
    return (
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Settings</h1>
        <div className="mt-5">
          <FormSkeleton cards={6} grid />
        </div>
      </div>
    );

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Settings</h1>
      <p className="mt-1 text-sm text-slate-600">
        Currencies, risk levels, operation areas, priority levels, irregularity types, and notification delivery
        configuration.
      </p>
      {!canEdit && (
        <p className="mt-2 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-600">
          View-only access - your role doesn&apos;t hold Settings &rsaquo; Edit, so every field below is read-only.
        </p>
      )}

      {/* Sections sit in a two-column grid on wide screens; items-start keeps an
          expanded section from stretching its closed neighbour to match. The two
          sections with wide content span both columns. */}
      <div className="mt-5 grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
      <CollapsibleCard disabled={!canEdit}
        title="Configurable Lists"
        description="Each list drives a dropdown on the Finding registration form. Expand a section to add or remove a value."
      >
        <div className="flex flex-col gap-2 p-4">
          <SettingsListEditor
            title="Currencies"
            items={settings.currencies}
            onChange={(items) => updateList("currencies", items)}
            defaultOpen
          />
          <SettingsListEditor
            title="Risk levels"
            description="Order matters - used top-to-bottom on dashboards' Risk Distribution widget."
            items={settings.riskLevels}
            onChange={(items) => updateList("riskLevels", items)}
          />
          <SettingsListEditor
            title="Operation areas"
            items={settings.operationAreas}
            onChange={(items) => updateList("operationAreas", items)}
          />
          <SettingsListEditor
            title="Priority levels"
            items={settings.priorityLevels}
            onChange={(items) => updateList("priorityLevels", items)}
          />
          <SettingsListEditor
            title="Irregularity types"
            items={settings.irregularityTypes}
            onChange={(items) => updateList("irregularityTypes", items)}
          />
        </div>
      </CollapsibleCard>

      <CollapsibleCard disabled={!canEdit} title="Notification Delivery">
        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="provider">Provider</Label>
            <Select
              id="provider"
              value={settings.notification.provider}
              onChange={(e) =>
                setSettings({ ...settings, notification: { ...settings.notification, provider: e.target.value as Settings["notification"]["provider"] } })
              }
            >
              <option value="NONE">None (disabled)</option>
              <option value="SMTP">SMTP relay</option>
              <option value="GRAPH">Outlook / Graph API</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="fromAddress">From address</Label>
            <Input
              id="fromAddress"
              type="email"
              value={settings.notification.fromAddress}
              onChange={(e) => setSettings({ ...settings, notification: { ...settings.notification, fromAddress: e.target.value } })}
            />
          </div>
          {settings.notification.provider === "SMTP" && (
            <>
              <div>
                <Label htmlFor="smtpHost">SMTP host</Label>
                <Input
                  id="smtpHost"
                  value={settings.notification.smtpHost ?? ""}
                  onChange={(e) => setSettings({ ...settings, notification: { ...settings.notification, smtpHost: e.target.value } })}
                />
              </div>
              <div>
                <Label htmlFor="smtpPort">SMTP port</Label>
                <Input
                  id="smtpPort"
                  type="number"
                  value={settings.notification.smtpPort ?? ""}
                  onChange={(e) =>
                    setSettings({ ...settings, notification: { ...settings.notification, smtpPort: Number(e.target.value) } })
                  }
                />
              </div>
            </>
          )}
        </div>
        {canEdit && (
        <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 p-4">
          <Button type="button" variant="secondary" onClick={handleTestEmail} disabled={testEmailSending}>
            {testEmailSending ? "Sending..." : "Send Test Email"}
          </Button>
          <p className="text-xs text-slate-500">
            Sends to your own account&apos;s email address. Save settings first if you just changed them.
          </p>
          {testEmailResult && (
            <p className={`text-sm ${testEmailResult.ok ? "text-emerald-700" : "text-red-600"}`}>{testEmailResult.message}</p>
          )}
        </div>
        )}
      </CollapsibleCard>

      <CollapsibleCard disabled={!canEdit}
        title="Case Transfer"
        description="Allow transferring outstanding findings when a period locks."
      >
        <div className="p-4">
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={settings.autoTransferOnLock}
              onChange={(e) => setSettings({ ...settings, autoTransferOnLock: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded border-slate-300"
            />
            <span>
              Allow transferring outstanding findings when their period locks
              <br />
              <span className="text-xs text-slate-500">
                When enabled, the Lock dialog on Reporting Periods asks the locking user whether to transfer this
                period&apos;s still-outstanding findings into the next open period - it&apos;s never silent or
                automatic. If they say yes, every still-outstanding finding moves, tagged &quot;Automatic&quot; in
                its transfer history (referring to the bulk-sweep mechanism, not that it ran unasked). A finding
                already transferred manually before the lock is skipped. Leave this off to hide that prompt
                entirely - findings still outstanding when a period locks then just stay put until someone
                transfers them manually.
              </span>
            </span>
          </label>
        </div>
      </CollapsibleCard>

      <CollapsibleCard disabled={!canEdit}
        title="Performance Ranking Visibility"
        description="Independently for branches and districts."
      >
        <div className="flex flex-col gap-3 p-4">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={settings.rankingVisibility.branches}
              onChange={(e) =>
                setSettings({ ...settings, rankingVisibility: { ...settings.rankingVisibility, branches: e.target.checked } })
              }
              className="h-4 w-4 rounded border-slate-300"
            />
            Show branch ranking/comparison (Branch Dashboard&apos;s own Branch Ranking, District Dashboard&apos;s Branch
            Ranking, HO Dashboard&apos;s Branch Comparison/Top-Performing Branches)
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={settings.rankingVisibility.districts}
              onChange={(e) =>
                setSettings({ ...settings, rankingVisibility: { ...settings.rankingVisibility, districts: e.target.checked } })
              }
              className="h-4 w-4 rounded border-slate-300"
            />
            Show district ranking/comparison (District Dashboard&apos;s own District Ranking, HO Dashboard&apos;s District
            Ranking)
          </label>
          <p className="text-xs text-slate-500">
            When enabled, every branch sees how it compares to its peer branches in the same district, and every
            district sees how it compares to every other district bank-wide - for competitive visibility. When
            disabled, a user only sees their own branch/district&apos;s own performance number, never how it compares
            to others. Neither setting ever lets a branch see another district&apos;s branches.
          </p>
        </div>
      </CollapsibleCard>

      <CollapsibleCard disabled={!canEdit}
        title="Rectification Reminders"
        description="A time-based nudge for findings sitting too long awaiting rectification."
      >
        <div className="flex flex-col gap-3 p-4">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={settings.rectificationReminders.enabled}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  rectificationReminders: { ...settings.rectificationReminders, enabled: e.target.checked },
                })
              }
              className="h-4 w-4 rounded border-slate-300"
            />
            Send reminder notifications for overdue rectifications
          </label>
          {settings.rectificationReminders.enabled && (
            <div className="max-w-xs">
              <Label htmlFor="reminderDays">Remind after (days without progress)</Label>
              <Input
                id="reminderDays"
                type="number"
                min="1"
                max="365"
                value={settings.rectificationReminders.thresholdDays}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    rectificationReminders: {
                      ...settings.rectificationReminders,
                      thresholdDays: Number(e.target.value) || 1,
                    },
                  })
                }
              />
            </div>
          )}
          <p className="text-xs text-slate-500">
            Reminds the Branch Manager/Controller when a finding has gone this many days without any rectification
            progress. Checked lazily off the existing notification poll (no scheduler in this app), so it may take a
            few minutes past the exact threshold to fire, never less.
          </p>
        </div>
      </CollapsibleCard>

      <CollapsibleCard disabled={!canEdit}
        title="Top / Bottom Performers"
        description="Thresholds driving the Top/Bottom Performers widgets on HO/District/Executive dashboards."
      >
        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="topPercent">Top performer: at or above (%)</Label>
            <Input
              id="topPercent"
              type="number"
              min="0"
              max="100"
              value={settings.performanceThresholds.topPercent}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  performanceThresholds: { ...settings.performanceThresholds, topPercent: Number(e.target.value) || 0 },
                })
              }
            />
          </div>
          <div>
            <Label htmlFor="bottomPercent">Bottom performer: at or below (%)</Label>
            <Input
              id="bottomPercent"
              type="number"
              min="0"
              max="100"
              value={settings.performanceThresholds.bottomPercent}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  performanceThresholds: { ...settings.performanceThresholds, bottomPercent: Number(e.target.value) || 0 },
                })
              }
            />
          </div>
          <p className="text-xs text-slate-500 sm:col-span-2">
            A district/branch qualifies as a &quot;Top Performer&quot; once its performance for the current period
            reaches the first value, and a &quot;Bottom Performer&quot; at or below the second. Every district/branch
            that clears the bar is shown - not a fixed top-5/bottom-5.
          </p>
        </div>
      </CollapsibleCard>

      <CollapsibleCard disabled={!canEdit}
        title="Bank-Wide Approval"
        description="Optional approval step for findings registered by a bank-wide (HO/Admin) user."
      >
        <div className="flex flex-col gap-3 p-4">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={settings.hoApproval.required}
              onChange={(e) => setSettings({ ...settings, hoApproval: { ...settings.hoApproval, required: e.target.checked } })}
              className="h-4 w-4 rounded border-slate-300"
            />
            Require approval before a bank-registered finding is sent to the branch
          </label>
          <p className="text-xs text-slate-500">
            A finding an HO Controller or Admin registers has no natural district to review it, so it never goes
            through District/HO Review. When this is off, it&apos;s sent straight to the Branch Manager on submit. When
            on, it waits for one of the approver(s) below instead.
          </p>
          <div>
            <Label>Approver(s) - bank-wide users only</Label>
            <div className="mt-1 flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border border-slate-200 p-2">
              {bankUsers.length === 0 && <p className="p-2 text-sm text-slate-500">No bank-wide users found.</p>}
              {bankUsers.map((u) => (
                <label key={u.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={settings.hoApproval.approverUserIds.includes(u.id)}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        hoApproval: {
                          ...settings.hoApproval,
                          approverUserIds: e.target.checked
                            ? [...settings.hoApproval.approverUserIds, u.id]
                            : settings.hoApproval.approverUserIds.filter((id) => id !== u.id),
                        },
                      })
                    }
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  {u.name} <span className="text-xs text-slate-500">({u.username})</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </CollapsibleCard>

      <CollapsibleCard disabled={!canEdit}
        title="Finding Registration Fields"
        description="Which fields must be filled in to register or edit a finding, vs. left blank."
      >
        <div className="flex flex-col gap-3 p-4">
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {REQUIRABLE_FINDING_FIELDS.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={settings.requiredFindingFields[key]}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      requiredFindingFields: { ...settings.requiredFindingFields, [key]: e.target.checked },
                    })
                  }
                  className="h-4 w-4 rounded border-slate-300"
                />
                {label}
              </label>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            Checked means required - the Register Finding form won&apos;t save without it, and bulk import rejects a
            row missing it. Unchecked means optional - it can be left blank on either path (a source/department/
            classified case left blank simply never matches anything scored or scoped by it, the way a blank text
            field just stays blank). Only reporting period, district/branch, amount, and number of cases aren&apos;t
            configurable here - those aren&apos;t content a registrant fills in, they&apos;re the identity and
            quantity every dashboard, report, and performance calculation is built around, so leaving one blank
            has no coherent meaning.
          </p>
        </div>
      </CollapsibleCard>

      <CollapsibleCard disabled={!canEdit}
        title={'Custom "Other" Values'}
        description="Which dropdowns let a registrant type in a value that isn't in the configured list."
      >
        <div className="flex flex-col gap-3 p-4">
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {OTHER_VALUE_ALLOWED_FIELDS.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={settings.allowOtherValueFields[key]}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      allowOtherValueFields: { ...settings.allowOtherValueFields, [key]: e.target.checked },
                    })
                  }
                  className="h-4 w-4 rounded border-slate-300"
                />
                {label}
              </label>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            Checked (default) means the dropdown offers &quot;Other (type in)&quot; when the value someone needs
            isn&apos;t in the list below - unchecked restricts it to that list only. Turning this off never hides or
            blocks an existing finding that already has a custom value from before - it only stops new ones from
            being typed in from a blank start.
          </p>
        </div>
      </CollapsibleCard>

      <CollapsibleCard disabled={!canEdit}
        title="Duplicate Finding Detection"
        description="Which fields the Register Finding form's 'similar finding already on record' check compares."
      >
        <div className="flex flex-col gap-3 p-4">
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {SIMILAR_FINDING_FIELDS.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={settings.similarFindingFields.includes(key)}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      similarFindingFields: e.target.checked
                        ? [...settings.similarFindingFields, key]
                        : settings.similarFindingFields.filter((f) => f !== key),
                    })
                  }
                  className="h-4 w-4 rounded border-slate-300"
                />
                {label}
              </label>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            A finding is flagged as a likely duplicate only when it matches on <strong>every</strong> field checked
            above - narrower selections (fewer fields) catch more possible duplicates but risk more false
            positives; broader selections (more fields) are stricter. This is only ever a suggestion shown to the
            person registering - it never blocks saving.
          </p>
        </div>
      </CollapsibleCard>

      <CollapsibleCard disabled={!canEdit}
        className="xl:col-span-2"
        title="Report Template Source Filters"
        description="Independently for each of the 11 report templates, which finding sources count toward that template's totals."
      >
        <div className="flex flex-col gap-5 p-4">
          {sources.length === 0 && (
            <p className="text-sm text-slate-500">
              No sources configured yet - add sources first at Admin &rarr; Sources, then return here to scope each
              report template to a subset.
            </p>
          )}
          {REPORT_TEMPLATES.map((t) => {
            const selected = settings.reportTemplateSources?.[t.slug] ?? [];
            return (
              <div key={t.slug} className="rounded-md border border-slate-200 p-3">
                <div className="mb-2">
                  <p className="text-sm font-medium text-slate-900">{t.label}</p>
                  <p className="text-xs text-slate-500">{t.description}</p>
                </div>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 md:grid-cols-3">
                  {sources
                    .filter((s) => s.active)
                    .map((s) => (
                      <label key={s.id} className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={selected.includes(s.id)}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              reportTemplateSources: {
                                ...settings.reportTemplateSources,
                                [t.slug]: e.target.checked
                                  ? [...selected, s.id]
                                  : selected.filter((id) => id !== s.id),
                              },
                            })
                          }
                          className="h-4 w-4 rounded border-slate-300"
                        />
                        <span>
                          {s.name}
                          <span className="text-xs text-slate-500"> ({s.code})</span>
                        </span>
                      </label>
                    ))}
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  {selected.length === 0
                    ? "All sources included (default)."
                    : `${selected.length} source${selected.length === 1 ? "" : "s"} selected — only findings from the checked source(s) appear on this report.`}
                </p>
              </div>
            );
          })}
        </div>
      </CollapsibleCard>

      <CollapsibleCard disabled={!canEdit}
        className="xl:col-span-2"
        title="Appearance"
        description="Font, text size, text contrast, and header & sidebar color used on every page of the app."
      >
        {(() => {
          const typography = normalizeTypography(settings.typography);
          const setTypography = (patch: Partial<Typography>) =>
            setSettings({ ...settings, typography: { ...typography, ...patch } });
          const sizeScale = { compact: 0.9375, default: 1, comfortable: 1.0625, large: 1.125 }[typography.textSize];
          const high = typography.textContrast === "high";
          const isDefault = isDefaultTypography(typography);
          return (
            <div className="flex flex-col gap-4 p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <Label htmlFor="typo-font">Font</Label>
                  <Select
                    id="typo-font"
                    value={typography.fontFamily}
                    onChange={(e) => setTypography({ fontFamily: e.target.value as Typography["fontFamily"] })}
                  >
                    {FONT_GROUPS.map((g) => (
                      <optgroup key={g.key} label={g.label}>
                        {FONT_OPTIONS.filter((o) => o.group === g.key).map((o) => (
                          <option key={o.key} value={o.key} style={{ fontFamily: fontStack(o.key) }}>
                            {o.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="typo-size">Text size</Label>
                  <Select
                    id="typo-size"
                    value={typography.textSize}
                    onChange={(e) => setTypography({ textSize: e.target.value as Typography["textSize"] })}
                  >
                    {TEXT_SIZE_OPTIONS.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.label}
                        {o.key === DEFAULT_TYPOGRAPHY.textSize ? " (default)" : ""}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="typo-contrast">Text contrast</Label>
                  <Select
                    id="typo-contrast"
                    value={typography.textContrast}
                    onChange={(e) => setTypography({ textContrast: e.target.value as Typography["textContrast"] })}
                  >
                    {TEXT_CONTRAST_OPTIONS.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-xs font-medium text-slate-600">Header &amp; sidebar color</p>
                {CHROME_GROUPS.map((g) => (
                <div key={g.key} className="mb-3 last:mb-0">
                <p className="mb-1 text-xs text-slate-500">{g.label}</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7" role="radiogroup" aria-label={`Header and sidebar color - ${g.label}`}>
                  {CHROME_OPTIONS.filter((o) => o.group === g.key).map((o) => {
                    const selected = typography.chrome === o.key;
                    return (
                      <button
                        key={o.key}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setTypography({ chrome: o.key })}
                        className={`flex flex-col overflow-hidden rounded-md border text-left transition-shadow ${
                          selected ? "border-brand-gold ring-2 ring-brand-gold/60" : "border-slate-200 hover:border-slate-300"
                        }`}
                      >
                        {/* Miniature app: header bar + sidebar in the option's
                            own palette, beside the (unchanged) page canvas. */}
                        <div className="flex h-14 bg-slate-100" style={chromeStyle(o.key)}>
                          <div className="flex w-1/3 flex-col gap-1 border-r border-chrome-border bg-chrome-bg p-1.5">
                            <span className="h-1 w-3/4 rounded-full bg-chrome-accent" />
                            <span className="h-1 w-full rounded-full bg-chrome-fg opacity-80" />
                            <span className="h-1.5 w-full rounded-sm bg-brand-gold" />
                            <span className="h-1 w-2/3 rounded-full bg-chrome-fg opacity-80" />
                          </div>
                          <div className="flex flex-1 flex-col">
                            <div className="flex h-3 items-center justify-end gap-0.5 border-b border-chrome-border bg-chrome-bg px-1">
                              <span className="h-1 w-3 rounded-full bg-chrome-fg opacity-80" />
                            </div>
                            <div className="m-1 flex-1 rounded-sm bg-white" />
                          </div>
                        </div>
                        <span className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-slate-700">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-slate-300" style={{ background: o.swatch }} />
                          <span className="truncate">{o.label}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                </div>
              ))}
                <p className="mt-1.5 text-xs text-slate-500">
                  The highlighted page link stays gold on every option. Light options add a thin border so the
                  sidebar and header stay distinct from the page, even on &quot;Page&quot;.
                </p>
              </div>

              <div>
                <p className="mb-1 text-xs font-medium text-slate-600">
                  Preview <span className="font-normal text-slate-500">- sample text only, not real data</span>
                </p>
                <div
                  className="rounded-md border border-slate-200 bg-slate-50 p-4"
                  style={{ fontFamily: fontStack(typography.fontFamily) }}
                >
                  <p className="font-semibold text-slate-900" style={{ fontSize: `${1.125 * sizeScale}rem` }}>
                    Findings Register
                  </p>
                  <p className={high ? "text-slate-700" : "text-slate-600"} style={{ fontSize: `${0.875 * sizeScale}rem` }}>
                    Every finding registered for the current reporting period, by district and branch.
                  </p>
                  <p className="mt-3 text-slate-800" style={{ fontSize: `${0.875 * sizeScale}rem` }}>
                    Cash shortage at teller 3 - ETB 12,450.00 - 4 cases
                  </p>
                  <p className={high ? "text-slate-600" : "text-slate-500"} style={{ fontSize: `${0.75 * sizeScale}rem` }}>
                    Registered 28 Sep 2026 by the Branch Controller · ሰላም 0123456789
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-slate-500">
                  Applies to every signed-in page for every user once saved. Web fonts look identical for everyone;
                  installed fonts depend on each user&apos;s computer and fall back to the closest match if missing. Text size scales spacing along with
                  text, so layouts keep their proportions. High contrast darkens secondary text (descriptions,
                  hints, table headers) one shade, in both light and dark themes.
                </p>
                {!isDefault && canEdit && (
                  <Button type="button" variant="secondary" onClick={() => setTypography({ ...DEFAULT_TYPOGRAPHY })}>
                    Reset to default
                  </Button>
                )}
              </div>
            </div>
          );
        })()}
      </CollapsibleCard>
      </div>

      {/* Pinned to the bottom of the screen: with a dozen collapsible
          sections above, the one Save button must never be out of reach. */}
      {canEdit ? (
        <StickyActions
          variant="page"
          className="mt-5"
          error={error}
          hint={saved ? <span className="text-sm text-emerald-600">Settings saved.</span> : "Changes apply to everyone once saved."}
        >
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Settings"}
          </Button>
        </StickyActions>
      ) : (
        error && <p className="mt-4 text-sm text-red-600">{error}</p>
      )}
    </div>
  );
}
