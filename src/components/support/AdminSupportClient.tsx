"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

type AdminThread = SupportThread & { userName: string; userRole: string | null };

function StatusBadge({ thread }: { thread: SupportThread }) {
  if (thread.status === "RESOLVED") return <Badge tone="green">Resolved{thread.rating ? ` - ${thread.rating}★` : ""}</Badge>;
  return <Badge tone="amber">Open</Badge>;
}

/**
 * The admin inbox: every user's support threads (GET /api/admin/support,
 * gated by support.view), replying via the same generic
 * POST /api/support/[id]/messages the end-user page uses (gated there by
 * support.respond) - one message model, two views onto it.
 */
export function AdminSupportClient({ canRespond }: { canRespond: boolean }) {
  const [threads, setThreads] = useState<AdminThread[] | null>(null);
  const pager = useClientPagination(threads ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [replyBody, setReplyBody] = useState("");
  const [sendingReply, setSendingReply] = useState(false);

  const selectedIdRef = useRef(selectedId);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const loadThreads = useCallback(async () => {
    try {
      const data = await apiGet<{ threads: AdminThread[] }>("/api/admin/support");
      setThreads(data.threads);
    } catch (err) {
      setError(errorMessage(err, "Failed to load threads"));
    }
  }, []);

  const loadThread = useCallback(async (id: string) => {
    try {
      const data = await apiGet<{ thread: SupportThread; messages: SupportMessage[] }>(`/api/support/${id}`);
      if (selectedIdRef.current !== id) return;
      setMessages(data.messages);
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

  const selectedThread = threads?.find((t) => t.id === selectedId) ?? null;

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

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[340px_1fr]">
      <Card>
        <CardHeader title="All Conversations" />
        <div className="max-h-[36rem] divide-y divide-slate-200 overflow-y-auto">
          {threads === null && <ListSkeleton rows={5} />}
          {threads?.length === 0 && <p className="p-4 text-sm text-slate-500">No support messages yet.</p>}
          {threads !== null && pager.pageItems.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelectedId(t.id)}
              className={`block w-full px-4 py-3 text-left text-sm hover:bg-slate-50 ${selectedId === t.id ? "bg-slate-50" : ""}`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="truncate font-medium text-slate-900">{t.userName}</p>
                <StatusBadge thread={t} />
              </div>
              <p className="mt-0.5 truncate text-xs text-slate-500">{t.subject}</p>
              <span className="text-xs text-slate-500">{formatDateTime(t.updatedAt)}</span>
            </button>
          ))}
        </div>
        <Pagination page={pager.page} totalPages={pager.totalPages} total={pager.total} pageSize={pager.pageSize} onPageChange={pager.setPage} />
      </Card>

      <Card>
        {!selectedThread ? (
          <div className="flex h-full items-center justify-center p-10 text-sm text-slate-500">Select a conversation.</div>
        ) : (
          <div className="flex h-full flex-col">
            <CardHeader
              title={`${selectedThread.userName} - ${selectedThread.subject}`}
              action={<StatusBadge thread={selectedThread} />}
            />
            <div className="flex max-h-[26rem] min-h-[10rem] flex-col gap-3 overflow-y-auto p-4">
              {messages === null && <ListSkeleton rows={3} />}
              {messages?.map((m) => (
                <div key={m.id} className={`flex flex-col ${m.senderIsSupport ? "items-end" : "items-start"}`}>
                  <div
                    className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                      m.senderIsSupport ? "bg-brand-gold text-on-gold" : "bg-white text-slate-900 ring-1 ring-slate-200"
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

            {!canRespond ? (
              <p className="border-t border-slate-200 p-4 text-sm text-slate-500">
                You can view this conversation but don&apos;t have permission to reply.
              </p>
            ) : selectedThread.status === "OPEN" ? (
              <form onSubmit={sendReply} className="flex flex-col gap-2 border-t border-slate-200 p-4">
                <Textarea
                  rows={2}
                  placeholder="Type a reply..."
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                />
                <div>
                  <Button type="submit" disabled={sendingReply || !replyBody.trim()}>
                    {sendingReply ? "Sending..." : "Reply"}
                  </Button>
                </div>
              </form>
            ) : (
              <p className="border-t border-slate-200 p-4 text-sm text-slate-500">
                This conversation is resolved ({selectedThread.rating}★).
              </p>
            )}
          </div>
        )}
      </Card>

      {error && <p className="lg:col-span-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
