"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend, ApiError } from "@/lib/api-client";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select, Label } from "@/components/ui/Field";
import type { Settings } from "@/types";

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [currenciesText, setCurrenciesText] = useState("");
  const [riskLevelsText, setRiskLevelsText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiGet<{ settings: Settings }>("/api/admin/settings").then(({ settings }) => {
      setSettings(settings);
      setCurrenciesText(settings.currencies.join(", "));
      setRiskLevelsText(settings.riskLevels.join(", "));
    });
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const payload = {
        currencies: currenciesText.split(",").map((s) => s.trim()).filter(Boolean),
        riskLevels: riskLevelsText.split(",").map((s) => s.trim()).filter(Boolean),
        notification: settings.notification,
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
      <p className="mt-1 text-sm text-slate-500">Currencies, risk levels and notification delivery configuration.</p>

      <Card className="mt-5">
        <CardHeader title="System Settings" />
        <form onSubmit={handleSave} className="flex flex-col gap-4 p-4">
          <div>
            <Label htmlFor="currencies">Currencies (comma-separated)</Label>
            <Input id="currencies" value={currenciesText} onChange={(e) => setCurrenciesText(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="riskLevels">Risk levels (comma-separated, in order)</Label>
            <Input id="riskLevels" value={riskLevelsText} onChange={(e) => setRiskLevelsText(e.target.value)} />
          </div>

          <div className="border-t border-slate-100 pt-4">
            <p className="mb-3 text-sm font-medium text-slate-800">Notification delivery</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {saved && <p className="text-sm text-emerald-600">Settings saved.</p>}
          <div>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
