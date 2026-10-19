"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Building2, Map as MapIcon, User, Users, X } from "lucide-react";
import { apiGet, apiSend } from "@/lib/api-client";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";
import { notify, notifications, presentError } from "@/lib/notify";
import { LIMITS, type AttachmentInfo, type Directory, type RecipientSelection } from "@/lib/communications/types";
import { AttachmentPicker } from "./AttachmentPicker";
import { RichMessageEditor, TextCounter, type RichMessageValue } from "./RichMessageEditor";

type Pick = { kind: "user" | "role" | "district" | "branch"; id: string; label: string; detail?: string };

const KIND_ICON = { user: User, role: Users, district: MapIcon, branch: Building2 } as const;
const KIND_LABEL = { user: "", role: "Role", district: "District", branch: "Branch" } as const;

/** The recipients a selection reaches, worked out the same way as the server (resolveRecipients). */
function reachOf(dir: Directory, toAll: boolean, picks: Pick[]): number {
  if (toAll) return dir.users.length;
  const users = new Set(picks.filter((p) => p.kind === "user").map((p) => p.id));
  const roles = new Set(picks.filter((p) => p.kind === "role").map((p) => p.label));
  const districts = new Set(picks.filter((p) => p.kind === "district").map((p) => p.label));
  const branches = new Set(picks.filter((p) => p.kind === "branch").map((p) => p.label));
  return dir.users.filter(
    (u) => users.has(u.id) || roles.has(u.roleName) || (u.districtName != null && districts.has(u.districtName)) || (u.branchName != null && branches.has(u.branchName))
  ).length;
}

/**
 * New message (docs/communications.md): To = All users, or any mix of people,
 * roles, districts and branches (each group reaches its active users, never
 * administrators); a subject; the text; up to 5 PDF / Word / Excel files.
 * Recipients are notified in the app and by email (the email carries the
 * whole text; attachments stay here).
 */
export function ComposeForm() {
  const router = useRouter();
  const [dir, setDir] = useState<Directory | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toAll, setToAll] = useState(false);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState<RichMessageValue>({ html: "", text: "" });
  const [attachments, setAttachments] = useState<AttachmentInfo[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Directory>("/api/communications/directory")
      .then(setDir)
      .catch((err) => setLoadError(presentError(err, notifications.communications.loadFailed).message));
  }, []);

  const options = useMemo<Pick[]>(() => {
    if (!dir) return [];
    return [
      ...dir.roles.map((r) => ({ kind: "role" as const, id: r.code, label: r.name })),
      ...dir.districts.map((d) => ({ kind: "district" as const, id: d.id, label: d.name })),
      ...dir.branches.map((b) => ({ kind: "branch" as const, id: b.id, label: b.name })),
      ...dir.users.map((u) => ({ kind: "user" as const, id: u.id, label: u.name, detail: [u.roleName, u.branchName ?? u.districtName].filter(Boolean).join(" · ") })),
    ];
  }, [dir]);

  const q = query.trim().toLowerCase();
  const matches = q
    ? options.filter((o) => !picks.some((p) => p.kind === o.kind && p.id === o.id) && `${o.label} ${o.detail ?? ""}`.toLowerCase().includes(q)).slice(0, 12)
    : [];
  const reach = dir ? reachOf(dir, toAll, picks) : 0;

  function add(o: Pick) {
    setPicks((p) => [...p, o]);
    setQuery("");
  }

  const selection: RecipientSelection = {
    toAll,
    userIds: picks.filter((p) => p.kind === "user").map((p) => p.id),
    roleCodes: picks.filter((p) => p.kind === "role").map((p) => p.id),
    districtIds: picks.filter((p) => p.kind === "district").map((p) => p.id),
    branchIds: picks.filter((p) => p.kind === "branch").map((p) => p.id),
  };
  const problem =
    !toAll && reach === 0
      ? "Choose who the message goes to"
      : !subject.trim()
        ? "Enter a subject"
        : !message.text
          ? "Write the message"
          : message.text.length > LIMITS.body
            ? `The message is longer than ${LIMITS.body} characters`
            : uploading
              ? "Wait for the attachments to finish uploading"
              : null;

  async function send() {
    if (problem) return;
    setSending(true);
    setError(null);
    try {
      const res = await apiSend<{ id: string; recipients: number }>("/api/communications", "POST", {
        subject: subject.trim(),
        body: message.text,
        bodyHtml: message.html,
        selection,
        attachmentIds: attachments.map((a) => a.id),
      });
      notify.success(notifications.communications.sent, { description: `${res.recipients} recipient(s)` });
      router.push(`/communications/${res.id}`);
      router.refresh();
    } catch (err) {
      setError(notify.formError(err, notifications.communications.sendFailed));
    } finally {
      setSending(false);
    }
  }

  if (loadError) return <p className="text-sm text-red-600">{loadError}</p>;
  if (!dir) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <Card className="p-4">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <div className="flex flex-col gap-2">
          <Label>To</Label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={toAll} onChange={(e) => setToAll(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
            All users ({dir.users.length})
          </label>
          {!toAll && (
            <>
              {picks.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {picks.map((p) => {
                    const Icon = KIND_ICON[p.kind];
                    return (
                      <span key={`${p.kind}-${p.id}`} className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs text-sky-900">
                        <Icon className="h-3 w-3" />
                        {KIND_LABEL[p.kind] && <span className="font-medium">{KIND_LABEL[p.kind]}:</span>}
                        {p.label}
                        <button type="button" onClick={() => setPicks((all) => all.filter((x) => x !== p))} className="rounded-full p-0.5 hover:bg-sky-100" aria-label={`Remove ${p.label}`}>
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
              <div className="relative">
                <Input
                  type="search"
                  placeholder="Search people, roles, districts or branches…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && matches[0]) {
                      e.preventDefault();
                      add(matches[0]);
                    }
                  }}
                  aria-label="Add recipients"
                />
                {matches.length > 0 && (
                  <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
                    {matches.map((o) => {
                      const Icon = KIND_ICON[o.kind];
                      return (
                        <li key={`${o.kind}-${o.id}`}>
                          <button type="button" onClick={() => add(o)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-50">
                            <Icon className="h-4 w-4 shrink-0 text-slate-500" />
                            <span className="text-slate-900">
                              {KIND_LABEL[o.kind] && <span className="text-slate-500">{KIND_LABEL[o.kind]}: </span>}
                              {o.label}
                            </span>
                            {o.detail && <span className="ml-auto truncate text-xs text-slate-500">{o.detail}</span>}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </>
          )}
          <p className="text-xs text-slate-500">
            {reach === 0 ? "Nobody chosen yet." : `Reaches ${reach} user(s).`} Administrators never receive messages; inactive users are skipped.
          </p>
        </div>

        <div>
          <Label htmlFor="comm-subject">Subject</Label>
          <Input id="comm-subject" maxLength={LIMITS.subject} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="What is it about?" />
        </div>

        <div>
          <Label htmlFor="comm-body">Message</Label>
          <RichMessageEditor id="comm-body" placeholder="Write your message" disabled={sending} onChange={setMessage} />
          <TextCounter text={message.text} />
        </div>

        <AttachmentPicker attachments={attachments} onChange={setAttachments} disabled={sending} onBusyChange={setUploading} />

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {problem && <span className="mr-auto text-xs text-slate-500">{problem}</span>}
          <Link href="/communications" className="rounded-md border border-slate-300 bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200">
            Cancel
          </Link>
          <Button type="submit" disabled={Boolean(problem) || sending}>
            {sending ? "Sending…" : "Send"}
          </Button>
        </div>
        <p className="text-xs text-slate-500">Each recipient is notified here and by email - the email carries the whole message; attachments are downloaded here.</p>
      </form>
    </Card>
  );
}
