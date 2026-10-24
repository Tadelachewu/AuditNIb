"use client";

import { countedChars, htmlToText, messageWords } from "@/lib/communications/plainText";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, apiSend } from "@/lib/api-client";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { notify, notifications, presentError } from "@/lib/notify";
import { LIMITS, selectionMatcher, type AttachmentInfo, type Directory, type RecipientSelection } from "@/lib/communications/types";
import { AttachmentPicker } from "./AttachmentPicker";
import { FieldLabel } from "./FieldLabel";
import { RichMessageEditor, TextCounter, type RichMessageValue } from "./RichMessageEditor";
import { EMPTY_SELECTION, RecipientPicker } from "./RecipientPicker";

/**
 * New message (docs/communications.md): To = Everyone, or ticked roles,
 * districts, branches and people (RecipientPicker - roles narrowed to the
 * ticked places; never administrators); a subject; the text; up to 5 PDF /
 * Word / Excel files.
 * Recipients are notified in the app and by email (the email carries the
 * whole text; attachments stay here).
 *
 * Forward (`forwardId`): starts from the forwarded message - the same subject,
 * the original as the body, its files attached - and is sent labelled
 * "Forwarded" for both sides. Otherwise an unsent draft from
 * earlier is restored (saved as you type, like Register Finding's - see
 * /api/communications/draft), with a banner and Discard.
 */
interface Draft {
  subject: string;
  html: string;
  selection: RecipientSelection;
  cc: RecipientSelection;
  attachments: AttachmentInfo[];
}

export function ComposeForm({ forwardId }: { forwardId?: string } = {}) {
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
  // The editor's starting content (forward / restored draft); a new key remounts it with that content.
  const [initialHtml, setInitialHtml] = useState<string | undefined>(undefined);
  const [editorKey, setEditorKey] = useState(0);
  const [ready, setReady] = useState(false);
  const [restored, setRestored] = useState(false);
  const sent = useRef(false);

  useEffect(() => {
    apiGet<Directory>("/api/communications/directory")
      .then(setDir)
      .catch((err) => setLoadError(presentError(err, notifications.communications.loadFailed).message));
  }, []);

  function startWith(d: { subject: string; html: string; attachments: AttachmentInfo[]; selection?: RecipientSelection; cc?: RecipientSelection }) {
    setSubject(d.subject);
    setMessage({ html: d.html, text: htmlToText(d.html) });
    setInitialHtml(d.html);
    setAttachments(d.attachments);
    if (d.selection) setSelection(d.selection);
    if (d.cc) setCc(d.cc);
    setEditorKey((k) => k + 1);
  }

  // Forward, or the draft from earlier - once, when the form opens.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (forwardId) {
        try {
          const f = await apiSend<{ subject: string; bodyHtml: string; attachments: AttachmentInfo[] }>(`/api/communications/${forwardId}/forward`, "POST");
          if (!cancelled) startWith({ subject: f.subject, html: f.bodyHtml, attachments: f.attachments });
        } catch (err) {
          if (!cancelled) setError(presentError(err, notifications.communications.loadFailed).message);
        }
      } else {
        const r = await apiGet<{ draft: Draft | null }>("/api/communications/draft").catch(() => ({ draft: null }));
        const d = r.draft;
        if (!cancelled && d && (d.subject || d.html || d.attachments?.length)) {
          startWith({ subject: d.subject ?? "", html: d.html ?? "", attachments: d.attachments ?? [], selection: d.selection ?? EMPTY_SELECTION, cc: d.cc ?? EMPTY_SELECTION });
          setRestored(true);
        }
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [forwardId]);

  // Saved as you type (a second after the last change); nothing typed = no draft.
  useEffect(() => {
    if (!ready || sent.current) return;
    const timer = setTimeout(() => {
      if (sent.current) return;
      const empty = !subject.trim() && !message.text && attachments.length === 0;
      if (empty) void apiSend("/api/communications/draft", "DELETE").catch(() => {});
      else void apiSend("/api/communications/draft", "PATCH", { subject, html: message.html, selection, cc, attachments } satisfies Draft).catch(() => {});
    }, 1000);
    return () => clearTimeout(timer);
  }, [ready, subject, message, selection, cc, attachments]);

  async function discardDraft() {
    setRestored(false);
    startWith({ subject: "", html: "", attachments: [], selection: EMPTY_SELECTION, cc: EMPTY_SELECTION });
    await apiSend("/api/communications/draft", "DELETE").catch(() => {});
  }

  // Same rule as the server (selectionMatcher), so the count is who receives it.
  const reach = useMemo(() => {
    if (!dir) return 0;
    const districtOf = new Map(dir.branches.map((x) => [x.id, x.districtId]));
    return dir.users.filter(selectionMatcher(selection, (id) => districtOf.get(id))).length;
  }, [dir, selection]);

  const problem =
    reach === 0
      ? "Choose who the message goes to"
      : countedChars(subject) < LIMITS.minText
        ? `Enter a subject (at least ${LIMITS.minText} characters, spaces don't count)`
        : countedChars(message.html ? htmlToText(message.html) : message.text) < LIMITS.minText
          ? `Write the message (at least ${LIMITS.minText} characters, spaces and line breaks don't count)`
          : messageWords(message) > LIMITS.body
            ? `The message is longer than ${LIMITS.body.toLocaleString("en-US")} words`
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
        forwardOfId: forwardId,
        attachmentIds: attachments.map((a) => a.id),
      });
      // Sent: the draft has done its job.
      sent.current = true;
      void apiSend("/api/communications/draft", "DELETE").catch(() => {});
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
  if (!dir || !ready) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <Card className="p-4">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {restored && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <span>Restored an unsent message from earlier (e.g. after a refresh or connection loss).</span>
            <Button type="button" variant="secondary" onClick={() => void discardDraft()}>
              Discard
            </Button>
          </div>
        )}

        {/* To and Cc at the top, side by side. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1">
            <FieldLabel>To</FieldLabel>
            <RecipientPicker dir={dir} value={selection} onChange={setSelection} label="To" />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <FieldLabel>Cc</FieldLabel>
            {selection.toAll ? (
              <p className="py-1.5 text-sm text-slate-500">Not needed - everyone receives it.</p>
            ) : (
              <RecipientPicker dir={dir} value={cc} onChange={setCc} label="Cc" allowEveryone={false} />
            )}
          </div>
        </div>

        <div>
          <FieldLabel htmlFor="comm-subject">Subject</FieldLabel>
          <Input id="comm-subject" maxLength={LIMITS.subject} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="What is it about?" />
        </div>

        <div>
          <FieldLabel htmlFor="comm-body">Message</FieldLabel>
          <RichMessageEditor key={editorKey} id="comm-body" placeholder="Write your message" disabled={sending} onChange={setMessage} initialHtml={initialHtml} />
          <TextCounter value={message} />
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
        <p className="text-xs text-slate-500">
          Each recipient is notified here and by email - the email carries the whole message; attachments are downloaded here. An unsent message is kept as a draft for 24 hours.
        </p>
      </form>
    </Card>
  );
}
