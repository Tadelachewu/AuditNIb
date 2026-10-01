"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Star } from "lucide-react";
import { apiGet, apiSend, errorMessage } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import type { SupportThread, SupportMessage } from "@/types";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { Pagination } from "@/components/ui/Pagination";
import { useClientPagination } from "@/lib/useClientPagination";
import { notify, notifications } from "@/lib/notify";

function StatusBadge({ thread }: { thread: SupportThread }) {
  if (thread.status === "RESOLVED") return <Badge tone="green">Resolved{thread.rating ? ` - ${thread.rating}★` : ""}</Badge>;
  return <Badge tone="amber">Open</Badge>;
}

/**
 * End-user support inbox: a list of the caller's own threads on the left, an
 * open conversation + reply + star-rating on the right. Polls at the same
 * 30s cadence as NotificationBell so a support reply shows up here without a
 * manual refresh.
 */
export function SupportClient() {
  const [threads, setThreads] = useState<SupportThread[] | null>(null);
  const pager = useClientPagination(threads ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newBody, setNewBody] = useState("");
  const [sendingNew, setSendingNew] = useState(false);

  const [replyBody, setReplyBody] = useState("");
  const [sendingReply, setSendingReply] = useState(false);

  const [rating, setRating] = useState<number | null>(null);
  const [ratingSaving, setRatingSaving] = useState(false);

  const selectedIdRef = useRef(selectedId);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const loadThreads = useCallback(async () => {
    try {
      const data = await apiGet<{ threads: SupportThread[] }>("/api/support", { background: true });
      setThreads(data.threads);
    } catch (err) {
      setError(errorMessage(err, "Failed to load threads"));
    }
  }, []);

  const loadThread = useCallback(async (id: string) => {
    try {
      const data = await apiGet<{ thread: SupportThread; messages: SupportMessage[] }>(`/api/support/${id}`, { background: true });
      if (selectedIdRef.current !== id) return;
      setMessages(data.messages);
      setThreads((prev) => (prev ? prev.map((t) => (t.id === id ? data.thread : t)) : prev));
    } catch (err) {
      setError(errorMessage(err, "Failed to load conversation"));
    }
  }, []);

  useEffect(() => {
    loadThreads();
    const interval = setInterval(loadThreads, 30_000);
    return () => clearInterval(interval);
  }, [loadThreads]);

  useEffect(() => {
    if (!selectedId) return;
    loadThread(selectedId);
    const interval = setInterval(() => loadThread(selectedId), 30_000);
    return () => clearInterval(interval);
  }, [selectedId, loadThread]);

  useEffect(() => {
    setRating(null);
  }, [selectedId]);

  const selectedThread = threads?.find((t) => t.id === selectedId) ?? null;

  async function sendNew(e: React.FormEvent) {
    e.preventDefault();
    if (!newBody.trim()) return;
    setError(null);
    setSendingNew(true);
    try {
      const data = await apiSend<{ thread: SupportThread }>("/api/support", "POST", { body: newBody });
      setNewBody("");
      await loadThreads();
      setSelectedId(data.thread.id);
    } catch (err) {
      setError(errorMessage(err, "Failed to send message"));
    } finally {
      setSendingNew(false);
    }
  }

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !replyBody.trim()) return;
    setError(null);
    setSendingReply(true);
    try {
      await apiSend(`/api/support/${selectedId}/messages`, "POST", { body: replyBody });
      notify.success(notifications.support.replySent);
      setReplyBody("");
      await Promise.all([loadThread(selectedId), loadThreads()]);
    } catch (err) {
      setError(errorMessage(err, "Failed to send message"));
    } finally {
      setSendingReply(false);
    }
  }

  async function rate(stars: number) {
    if (!selectedId) return;
    setError(null);
    setRatingSaving(true);
    try {
      await apiSend(`/api/support/${selectedId}/rate`, "POST", { rating: stars });
      notify.success(notifications.support.rated);
      setRating(stars);
      await Promise.all([loadThread(selectedId), loadThreads()]);
    } catch (err) {
      setError(errorMessage(err, "Failed to save rating"));
    } finally {
      setRatingSaving(false);
    }
  }

  const lastMessage = messages && messages.length > 0 ? messages[messages.length - 1] : null;
  const canRate = selectedThread?.status === "OPEN" && lastMessage?.senderIsSupport;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[320px_1fr]">
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader title="New Message" description="Start a new conversation with support." />
          <form onSubmit={sendNew} className="flex flex-col gap-2 p-4">
            <Textarea
              rows={3}
              placeholder="Describe your question or issue..."
              value={newBody}
              onChange={(e) => setNewBody(e.target.value)}
            />
            <Button type="submit" disabled={sendingNew || !newBody.trim()}>
              {sendingNew ? "Sending..." : "Send"}
            </Button>
          </form>
        </Card>

        <Card>
          <CardHeader title="My Conversations" />
          <div className="max-h-[28rem] divide-y divide-slate-200 overflow-y-auto">
            {threads === null && <ListSkeleton rows={5} />}
            {threads?.length === 0 && <p className="p-4 text-sm text-slate-500">No messages yet.</p>}
            {threads !== null && pager.pageItems.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className={`block w-full px-4 py-3 text-left text-sm hover:bg-slate-50 ${selectedId === t.id ? "bg-slate-50" : ""}`}
              >
                <p className="truncate font-medium text-slate-900">{t.subject}</p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <StatusBadge thread={t} />
                  <span className="text-xs text-slate-500">{formatDateTime(t.updatedAt)}</span>
                </div>
              </button>
            ))}
          </div>
          <Pagination page={pager.page} totalPages={pager.totalPages} total={pager.total} pageSize={pager.pageSize} onPageChange={pager.setPage} />
        </Card>
      </div>

      <Card>
        {!selectedThread ? (
          <div className="flex h-full items-center justify-center p-10 text-sm text-slate-500">
            Select a conversation, or start a new one.
          </div>
        ) : (
          <div className="flex h-full flex-col">
            <CardHeader title={selectedThread.subject} action={<StatusBadge thread={selectedThread} />} />
            <div className="flex max-h-[26rem] min-h-[10rem] flex-col gap-3 overflow-y-auto p-4">
              {messages === null && <ListSkeleton rows={3} />}
              {messages?.map((m) => (
                <div key={m.id} className={`flex flex-col ${m.senderIsSupport ? "items-start" : "items-end"}`}>
                  <div
                    className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                      m.senderIsSupport ? "bg-white text-slate-900 ring-1 ring-slate-200" : "bg-brand-gold text-on-gold"
                    }`}
                  >
                    {m.body}
                  </div>
                  <span className="mt-1 text-xs text-slate-500">
                    {m.senderIsSupport ? "Support" : m.senderName} - {formatDateTime(m.createdAt)}
                  </span>
                </div>
              ))}
            </div>

            {canRate && (
              <div className="border-t border-slate-200 px-4 py-3">
                <p className="text-xs font-medium text-slate-600">Are you satisfied with this response?</p>
                <div className="mt-1 flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} type="button" disabled={ratingSaving} onClick={() => rate(n)} aria-label={`Rate ${n} stars`}>
                      <Star
                        size={22}
                        className={n <= (rating ?? 0) ? "fill-amber-400 text-amber-400" : "text-slate-300"}
                      />
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-slate-500">5 stars closes this conversation. Fewer stars keeps it open - send another message below.</p>
              </div>
            )}

            {selectedThread.status === "OPEN" ? (
              <form onSubmit={sendReply} className="flex flex-col gap-2 border-t border-slate-200 p-4">
                <Textarea
                  rows={2}
                  placeholder="Type a message..."
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                />
                <div>
                  <Button type="submit" disabled={sendingReply || !replyBody.trim()}>
                    {sendingReply ? "Sending..." : "Send"}
                  </Button>
                </div>
              </form>
            ) : (
              <p className="border-t border-slate-200 p-4 text-sm text-slate-500">
                This conversation is resolved. Send a new message above to start a new one.
              </p>
            )}
          </div>
        )}
      </Card>

      {error && <p className="lg:col-span-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
