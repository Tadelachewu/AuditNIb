"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, apiSend } from "@/lib/api-client";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";
import { notify, notifications, presentError } from "@/lib/notify";
import { LIMITS, selectionMatcher, type AttachmentInfo, type Directory, type RecipientSelection } from "@/lib/communications/types";
import { AttachmentPicker } from "./AttachmentPicker";
import { RichMessageEditor, TextCounter, type RichMessageValue } from "./RichMessageEditor";
import { EMPTY_SELECTION, RecipientPicker } from "./RecipientPicker";

/**
 * New message (docs/communications.md): To = Everyone, or ticked roles,
 * districts, branches and people (RecipientPicker - roles narrowed to the
 * ticked places; never administrators); a subject; the text; up to 5 PDF /
 * Word / Excel files.
 * Recipients are notified in the app and by email (the email carries the
 * whole text; attachments stay here).
 */
export function ComposeForm() {
  const router = useRouter();
  const [dir, setDir] = useState<Directory | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selection, setSelection] = useState<RecipientSelection>(EMPTY_SELECTION);
  // Cc: optional copies, the same picker without "Everyone".
  const [cc, setCc] = useState<RecipientSelection>(EMPTY_SELECTION);
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

  // Same rule as the server (selectionMatcher), so the count is who receives it.
  const reach = useMemo(() => {
    if (!dir) return 0;
    const districtOf = new Map(dir.branches.map((x) => [x.id, x.districtId]));
    return dir.users.filter(selectionMatcher(selection, (id) => districtOf.get(id))).length;
  }, [dir, selection]);

  const problem =
    reach === 0
      ? "Choose who the message goes to"
      : subject.trim().length < LIMITS.minText
        ? `Enter a subject (at least ${LIMITS.minText} characters)`
        : message.text.trim().length < LIMITS.minText
          ? `Write the message (at least ${LIMITS.minText} characters)`
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
        // No Cc with "Everyone" - everyone already receives it.
        cc: selection.toAll ? undefined : cc,
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
        {/* To and Cc at the top, side by side. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1">
            <Label>To</Label>
            <RecipientPicker dir={dir} value={selection} onChange={setSelection} label="To" />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <Label>Cc</Label>
            {selection.toAll ? (
              <p className="py-1.5 text-sm text-slate-500">Not needed - everyone receives it.</p>
            ) : (
              <RecipientPicker dir={dir} value={cc} onChange={setCc} label="Cc" allowEveryone={false} />
            )}
          </div>
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

        {/* Attachments at the bottom-right, under the message. */}
        <div className="flex justify-end">
          <AttachmentPicker attachments={attachments} onChange={setAttachments} disabled={sending} onBusyChange={setUploading} align="end" />
        </div>

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
