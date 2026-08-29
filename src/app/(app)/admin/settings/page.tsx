"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend, ApiError } from "@/lib/api-client";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select, Label } from "@/components/ui/Field";
import { SettingsListEditor } from "@/components/admin/SettingsListEditor";
import type { Settings } from "@/types";

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiGet<{ settings: Settings }>("/api/admin/settings").then(({ settings }) => setSettings(settings));
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
      };
      const res = await apiSend<{ settings: Settings }>("/api/admin/settings", "PATCH", payload);
      setSettings(res.settings);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return <p className="text-sm text-slate-400">Loading...</p>;

  return (
    <div className="max-w-2xl">
      <h1 className="text-lg font-semibold text-slate-900">Settings</h1>
      <p className="mt-1 text-sm text-slate-500">
        Currencies, risk levels, operation areas, priority levels, irregularity types, and notification delivery
        configuration.
      </p>

      <Card className="mt-5">
        <CardHeader
          title="Configurable Lists"
          description="Each list drives a dropdown on the Finding registration form. Expand a section to add or remove a value."
        />
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
      </Card>

      <Card className="mt-4">
        <CardHeader title="Notification Delivery" />
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
      </Card>

      <Card className="mt-4">
        <CardHeader title="Case Transfer" description="Configurable automatic transfer of outstanding findings when a period locks." />
        <div className="p-4">
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={settings.autoTransferOnLock}
              onChange={(e) => setSettings({ ...settings, autoTransferOnLock: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded border-slate-300"
            />
            <span>
              Automatically transfer outstanding findings when their period locks
              <br />
              <span className="text-xs text-slate-400">
                Moves every still-outstanding finding into the next open period the moment a District/HO Controller
                locks the period, tagged &quot;Automatic&quot; in its transfer history. A finding already transferred
                manually before the lock is skipped.
              </span>
            </span>
          </label>
        </div>
      </Card>

      <Card className="mt-4">
        <CardHeader title="Performance Ranking Visibility" description="Independently for branches and districts." />
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
          <p className="text-xs text-slate-400">
            When enabled, every branch sees how it compares to its peer branches in the same district, and every
            district sees how it compares to every other district bank-wide - for competitive visibility. When
            disabled, a user only sees their own branch/district&apos;s own performance number, never how it compares
            to others. Neither setting ever lets a branch see another district&apos;s branches.
          </p>
        </div>
      </Card>

      <Card className="mt-4">
        <CardHeader
          title="Rectification Reminders"
          description="A time-based nudge for findings sitting too long awaiting rectification."
        />
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
          <p className="text-xs text-slate-400">
            Reminds the Branch Manager/Controller when a finding has gone this many days without any rectification
            progress. Checked lazily off the existing notification poll (no scheduler in this app), so it may take a
            few minutes past the exact threshold to fire, never less.
          </p>
        </div>
      </Card>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      {saved && <p className="mt-4 text-sm text-emerald-600">Settings saved.</p>}
      <div className="mt-4">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}
