"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Download, FileText, Reply, ReplyAll, Trash2, Undo2 } from "lucide-react";
import { apiGet, apiSend } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Label } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { notify, notifications, presentError } from "@/lib/notify";
import { LIMITS, type AttachmentInfo, type MessageView, type ThreadView } from "@/lib/communications/types";
import { AttachmentPicker, formatBytes } from "./AttachmentPicker";
import { RichMessageEditor, TextCounter, type RichMessageValue } from "./RichMessageEditor";

/**
 * One conversation (docs/communications.md): every message in it this user
 * sent or received, oldest first, the opened one highlighted. Opening it
 * marks it read. Reply goes to the sender; Reply all to everyone on the
 * message (not offered for an "All users" message).
 */
export function ThreadClient({ id, canSend }: { id: string; canSend: boolean }) {
  const router = useRouter();
  const [thread, setThread] = useState<ThreadView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setThread(await apiGet<ThreadView>(`/api/communications/${id}`));
      setError(null);
    } catch (err) {
      setError(presentError(err, notifications.communications.loadFailed).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <div className="flex flex-col gap-3">
        <BackLink />
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }
  if (!thread) return <p className="text-sm text-slate-500">Loading…</p>;

  const last = thread.messages[thread.messages.length - 1];
  return (
    <div className="flex flex-col gap-4">
      <BackLink />
      <h1 className="text-lg font-semibold text-slate-900">{thread.subject}</h1>
      {thread.messages.map((m) => (
        <MessageCard key={m.id} m={m} highlighted={m.id === thread.openedId} onChanged={() => void load()} onRemoved={() => router.push("/communications")} />
      ))}
      {canSend && !last.withdrawnAt && <ReplyBox message={last} onSent={(newId) => router.push(`/communications/${newId}`)} />}
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/communications" className="inline-flex w-fit items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
      <ArrowLeft className="h-4 w-4" />
      Communications
    </Link>
  );
}

function MessageCard({ m, highlighted, onChanged, onRemoved }: { m: MessageView; highlighted: boolean; onChanged: () => void; onRemoved: () => void }) {
  const [busy, setBusy] = useState(false);
  const to = m.toAll
    ? `All users (${m.recipientCount})`
    : m.recipientCount > m.recipientNames.length
      ? `${m.recipientNames.join(", ")} and ${m.recipientCount - m.recipientNames.length} more`
      : m.recipientNames.join(", ");

  async function withdraw() {
    setBusy(true);
    try {
      await apiSend(`/api/communications/${m.id}/withdraw`, "POST");
      notify.success(notifications.communications.withdrawn);
      onChanged();
    } catch (err) {
      notify.fromError(err, notifications.communications.withdrawFailed);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await apiSend(`/api/communications/${m.id}`, "DELETE");
      notify.success(notifications.communications.removed);
      onRemoved();
    } catch (err) {
      notify.fromError(err, notifications.communications.removeFailed);
      setBusy(false);
    }
  }

  return (
    <Card className={highlighted ? "ring-2 ring-sky-300" : ""}>
      <div className="flex flex-wrap items-start gap-2 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">{m.senderName}</p>
          <p className="text-xs text-slate-500">To: {to}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-xs text-slate-500">{formatDateTime(m.createdAt)}</span>
          {m.withdrawnAt ? (
            <Badge tone="gray">Withdrawn</Badge>
          ) : (
            m.mine && <Badge tone={m.readCount === m.recipientCount ? "green" : "blue"}>Read {m.readCount}/{m.recipientCount}</Badge>
          )}
        </div>
      </div>
      <div className="px-4 py-3">
        {m.bodyHtml ? (
          // Sanitised on the server when saved and again when sent here (src/lib/communications/richText.ts).
          <div className="comm-rich break-words text-sm text-slate-900" dangerouslySetInnerHTML={{ __html: m.bodyHtml }} />
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm text-slate-900">{m.body}</p>
        )}
        {m.attachments.length > 0 && <Attachments items={m.attachments} />}
      </div>
      {(m.canWithdraw || !m.mine) && (
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-4 py-2">
          {m.canWithdraw && (
            <Button variant="warning" className="px-2 py-1 text-xs" onClick={() => void withdraw()} disabled={busy} title={`Possible within ${LIMITS.withdrawMinutes} minutes of sending, while nobody has opened it`}>
              <Undo2 className="h-3.5 w-3.5" />
              Withdraw
            </Button>
          )}
          {!m.mine && (
            <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => void remove()} disabled={busy} title="Removes it from your Inbox only">
              <Trash2 className="h-3.5 w-3.5" />
              Remove from my inbox
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

function Attachments({ items }: { items: AttachmentInfo[] }) {
  return (
    <ul className="mt-3 flex flex-col gap-1">
      {items.map((a) => (
        <li key={a.id}>
          <a href={`/api/communications/attachments/${a.id}`} className="inline-flex max-w-full items-center gap-2 rounded-md border border-slate-200 px-2 py-1 text-sm text-sky-700 hover:bg-slate-50">
            <FileText className="h-4 w-4 shrink-0" />
            <span className="truncate">{a.fileName}</span>
            <span className="shrink-0 text-xs text-slate-500">{formatBytes(a.size)}</span>
            <Download className="h-3.5 w-3.5 shrink-0" />
          </a>
        </li>
      ))}
    </ul>
  );
}

function ReplyBox({ message, onSent }: { message: MessageView; onSent: (id: string) => void }) {
  const [reply, setReply] = useState<RichMessageValue>({ html: "", text: "" });
  // Changing it remounts (clears) the editor after a reply is sent.
  const [editorKey, setEditorKey] = useState(0);
  const [attachments, setAttachments] = useState<AttachmentInfo[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState<"reply" | "all" | null>(null);
  const empty = !reply.text || reply.text.length > LIMITS.body;
  const [error, setError] = useState<string | null>(null);
  // Reply all = the sender and everyone else on a message you received. Not
  // offered for an "All users" message (it would message everyone again), nor
  // on your own message (Reply already goes to all its recipients).
  const canReplyAll = !message.mine && !message.toAll && message.recipientCount > 1;

  async function send(all: boolean) {
    if (empty || uploading) return;
    setSending(all ? "all" : "reply");
    setError(null);
    try {
      const res = await apiSend<{ id: string; recipients: number }>("/api/communications", "POST", {
        body: reply.text,
        bodyHtml: reply.html,
        replyToId: message.id,
        replyAll: all,
        attachmentIds: attachments.map((a) => a.id),
      });
      notify.success(notifications.communications.sent, { description: `${res.recipients} recipient(s)` });
      setReply({ html: "", text: "" });
      setEditorKey((k) => k + 1);
      setAttachments([]);
      onSent(res.id);
    } catch (err) {
      setError(notify.formError(err, notifications.communications.sendFailed));
    } finally {
      setSending(null);
    }
  }

  const label = message.mine ? "Follow up to the recipients" : `Reply to ${message.senderName}`;
  return (
    <Card className="p-4">
      <div className="flex flex-col gap-3">
        <div>
          <Label htmlFor="comm-reply">{label}</Label>
          <RichMessageEditor key={editorKey} id="comm-reply" placeholder="Write your reply" minHeight={120} disabled={sending !== null} onChange={setReply} />
          <TextCounter text={reply.text} />
        </div>
        <AttachmentPicker attachments={attachments} onChange={setAttachments} disabled={sending !== null} onBusyChange={setUploading} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {message.mine && message.toAll ? (
            <span className="mr-auto text-xs text-slate-500">To follow up a message sent to all users, send a new message.</span>
          ) : (
            <>
              {canReplyAll && (
                <Button variant="secondary" onClick={() => void send(true)} disabled={empty || uploading || sending !== null}>
                  <ReplyAll className="h-4 w-4" />
                  {sending === "all" ? "Sending…" : "Reply all"}
                </Button>
              )}
              <Button onClick={() => void send(false)} disabled={empty || uploading || sending !== null}>
                <Reply className="h-4 w-4" />
                {sending === "reply" ? "Sending…" : "Reply"}
              </Button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
