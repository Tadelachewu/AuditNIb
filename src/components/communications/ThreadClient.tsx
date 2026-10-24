"use client";

import { FieldLabel } from "./FieldLabel";
import { countedChars, htmlToText, messageWords } from "@/lib/communications/plainText";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Download, FileText, Forward, Reply, ReplyAll, Trash2, Undo2 } from "lucide-react";
import { apiGet, apiSend } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { notify, notifications, presentError } from "@/lib/notify";
import { LIMITS, type AttachmentInfo, type ForwardOrigin, type MessageView, type ThreadView } from "@/lib/communications/types";
import { AttachmentPicker, formatBytes } from "./AttachmentPicker";
import { ForwardedLabel } from "./ForwardedLabel";
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
  /** The message Reply / Reply all was clicked on (null: the last one). */
  const [replyToId, setReplyToId] = useState<string | null>(null);

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
  // The reply box answers the last message, or the one whose Reply / Reply all was clicked.
  const target = thread.messages.find((m) => m.id === replyToId && !m.withdrawnAt) ?? last;
  function replyTo(id: string) {
    setReplyToId(id);
    requestAnimationFrame(() => document.getElementById("comm-reply-box")?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }
  return (
    <div className="flex flex-col gap-4">
      <BackLink />
      <h1 className="text-lg font-semibold text-slate-900">{thread.subject}</h1>
      {thread.messages.map((m) => (
        <MessageCard
          key={m.id}
          m={m}
          canSend={canSend}
          highlighted={m.id === thread.openedId}
          onReply={() => replyTo(m.id)}
          onChanged={() => void load()}
          onRemoved={() => router.push("/communications")}
        />
      ))}
      {canSend && !target.withdrawnAt && (
        <ReplyBox message={target} isLast={target.id === last.id} onBackToLast={() => setReplyToId(null)} onSent={(newId) => router.push(`/communications/${newId}`)} />
      )}
    </div>
  );
}

/**
 * Reply all = the sender and everyone else on a message you received - on a
 * forward, also the original's author. Not for an "All users" message (it
 * would message everyone again), nor your own message (Reply already goes to
 * all its recipients).
 */
function canReplyAll(m: MessageView): boolean {
  return !m.mine && !m.toAll && (m.recipientCount > 1 || m.forwardedFrom !== null);
}

function BackLink() {
  return (
    // Bold, on the brand gold - the same look as the app's Back button and New message.
    <Link
      href="/communications"
      className="inline-flex w-fit items-center gap-1 rounded-md bg-brand-gold px-3 py-1.5 text-sm font-bold text-on-gold transition-colors hover:bg-brand-gold-dark"
    >
      <ArrowLeft className="h-4 w-4" />
      Communications
    </Link>
  );
}

function MessageCard({
  m,
  canSend,
  highlighted,
  onReply,
  onChanged,
  onRemoved,
}: {
  m: MessageView;
  canSend: boolean;
  highlighted: boolean;
  /** Points the reply box at this message. */
  onReply: () => void;
  onChanged: () => void;
  onRemoved: () => void;
}) {
  const canForward = canSend;
  // Reply / Reply all on every message you received (not withdrawn), like Outlook.
  const canReply = canSend && !m.mine && !m.withdrawnAt;
  const [busy, setBusy] = useState(false);
  const toCount = m.recipientCount - m.ccCount;
  const list = (names: string[], count: number) => (count > names.length ? `${names.join(", ")} and ${count - names.length} more` : names.join(", "));
  const to = m.toAll ? `All users (${m.recipientCount})` : list(m.recipientNames, toCount);
  const cc = m.ccCount > 0 ? list(m.ccNames, m.ccCount) : null;

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
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
            {m.senderName}
            {m.forwarded && <ForwardedLabel />}
          </p>
          <p className="text-xs text-slate-500"><span className="font-semibold text-slate-600">To:</span> {to}</p>
          {cc && <p className="text-xs text-slate-500"><span className="font-semibold text-slate-600">Cc:</span> {cc}</p>}
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
        {m.forwardedFrom && <ForwardOriginBox origin={m.forwardedFrom} />}
        {m.bodyHtml ? (
          // Sanitised on the server when saved and again when sent here (src/lib/communications/richText.ts).
          <div className="comm-rich break-words text-sm text-slate-900" dangerouslySetInnerHTML={{ __html: m.bodyHtml }} />
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm text-slate-900">{m.body}</p>
        )}
        {m.attachments.length > 0 && <Attachments items={m.attachments} />}
      </div>
      {(m.canWithdraw || !m.mine || (canForward && !m.withdrawnAt)) && (
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-4 py-2">
          {canReply && (
            <Button variant="secondary" className="px-2 py-1 text-xs" onClick={onReply} title={`Reply to ${m.senderName}`}>
              <Reply className="h-3.5 w-3.5" />
              Reply
            </Button>
          )}
          {canReply && canReplyAll(m) && (
            <Button variant="secondary" className="px-2 py-1 text-xs" onClick={onReply} title="Reply to the sender and everyone on this message">
              <ReplyAll className="h-3.5 w-3.5" />
              Reply all
            </Button>
          )}
          {canForward && !m.withdrawnAt && (
            // A new message, pre-filled: the same subject, this message as the body, its files attached; sent labelled "Forwarded".
            <Link
              href={`/communications/new?forward=${m.id}`}
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Forward className="h-3.5 w-3.5" />
              Forward
            </Link>
          )}
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

/** Where a forward came from - from the stored original, not the forward's text (the forwarder can't change it). */
function ForwardOriginBox({ origin }: { origin: ForwardOrigin }) {
  const row = (label: string, value: string) => (
    <div className="flex gap-2">
      <dt className="w-16 shrink-0 font-semibold text-slate-600">{label}:</dt>
      <dd className="min-w-0 break-words text-slate-800">{value}</dd>
    </div>
  );
  return (
    <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
      <p className="mb-1 font-semibold text-slate-700">Forwarded message</p>
      <dl className="flex flex-col gap-0.5">
        {row("From", origin.senderName)}
        {row("Sent", formatDateTime(origin.createdAt))}
        {row("To", origin.to)}
        {origin.cc && row("Cc", origin.cc)}
        {row("Subject", origin.subject)}
      </dl>
    </div>
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

function ReplyBox({ message, isLast, onBackToLast, onSent }: { message: MessageView; isLast: boolean; onBackToLast: () => void; onSent: (id: string) => void }) {
  const [reply, setReply] = useState<RichMessageValue>({ html: "", text: "" });
  // Changing it remounts (clears) the editor after a reply is sent.
  const [editorKey, setEditorKey] = useState(0);
  const [attachments, setAttachments] = useState<AttachmentInfo[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState<"reply" | "all" | null>(null);
  const empty = countedChars(reply.html ? htmlToText(reply.html) : reply.text) < LIMITS.minText || messageWords(reply) > LIMITS.body;
  const [error, setError] = useState<string | null>(null);
  const replyAll = canReplyAll(message);

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

  const label = message.mine ? "Follow up to the recipients" : isLast ? `Reply to ${message.senderName}` : `Reply to ${message.senderName}'s message of ${formatDateTime(message.createdAt)}`;
  return (
    <Card className="p-4">
      <div id="comm-reply-box" className="flex scroll-mt-20 flex-col gap-3">
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <FieldLabel htmlFor="comm-reply">{label}</FieldLabel>
            {!isLast && (
              <button type="button" onClick={onBackToLast} className="text-xs text-sky-700 hover:underline">
                Reply to the latest message instead
              </button>
            )}
          </div>
          <RichMessageEditor key={editorKey} id="comm-reply" placeholder="Write your reply" minHeight={120} disabled={sending !== null} onChange={setReply} />
          <TextCounter value={reply} />
        </div>
        <AttachmentPicker attachments={attachments} onChange={setAttachments} disabled={sending !== null} onBusyChange={setUploading} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {message.mine && message.toAll ? (
            <span className="mr-auto text-xs text-slate-500">To follow up a message sent to all users, send a new message.</span>
          ) : (
            <>
              {replyAll && (
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
