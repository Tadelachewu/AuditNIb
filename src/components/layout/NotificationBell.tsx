"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiSend, ApiError } from "@/lib/api-client";
import type { Notification } from "@/types";

// master.txt §12's in-app notification center: bell + unread badge, polled
// rather than pushed (no websocket infrastructure exists elsewhere in the
// app) - a 30s interval is frequent enough for a review workflow that
// already refreshes on every navigation.
export function NotificationBell() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // Which notification is currently showing its "add a comment?" prompt -
  // acknowledging a Finding notification (marking it seen) offers this
  // instead of immediately navigating away, so the reply lands right where
  // the other party will see it without a separate trip to the finding.
  const [respondingTo, setRespondingTo] = useState<string | null>(null);
  const [commentText, setCommentText] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);

  async function load() {
    try {
      const { notifications } = await apiGet<{ notifications: Notification[] }>("/api/notifications");
      setNotifications(notifications);
    } catch {
      // Non-critical - the bell just stays at its last known state.
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setRespondingTo(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const unreadCount = notifications.filter((n) => !n.readAt).length;

  async function markRead(n: Notification) {
    if (n.readAt) return;
    await apiSend(`/api/notifications/${n.id}/read`, "POST").catch(() => {});
    setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
  }

  // Clicking a Finding notification marks it seen and, rather than
  // immediately navigating away, offers an optional comment right there -
  // "I've seen this, and here's a note" in one step. Anything else keeps
  // the old behavior (mark read, then go straight to it).
  async function handleOpenNotification(n: Notification) {
    await markRead(n);
    if (n.entityType === "Finding") {
      // Re-clicking the same notification while its composer is already
      // open must not wipe an in-progress draft.
      if (respondingTo !== n.id) {
        setCommentError(null);
        setCommentText("");
        setRespondingTo(n.id);
      }
    } else {
      setOpen(false);
      router.refresh();
    }
  }

  function goToFinding(n: Notification) {
    setOpen(false);
    setRespondingTo(null);
    router.push(`/findings/${n.entityId}`);
  }

  async function handlePostComment(n: Notification) {
    const text = commentText.trim();
    if (!text) {
      goToFinding(n);
      return;
    }
    setPostingComment(true);
    setCommentError(null);
    try {
      await apiSend(`/api/findings/${n.entityId}/comments`, "POST", { text });
      goToFinding(n);
    } catch (err) {
      setCommentError(err instanceof ApiError ? err.message : "Failed to post comment");
    } finally {
      setPostingComment(false);
    }
  }

  async function handleMarkAllRead() {
    await apiSend("/api/notifications/read-all", "POST").catch(() => {});
    setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-full p-2 text-slate-500 hover:bg-slate-100"
        aria-label="Notifications"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
          />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-medium text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-md border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <span className="text-sm font-medium text-slate-900">Notifications</span>
            {unreadCount > 0 && (
              <button type="button" onClick={handleMarkAllRead} className="text-xs text-blue-700 hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-3 py-4 text-sm text-slate-500">No notifications yet.</p>
            ) : (
              notifications.map((n) => (
                <div key={n.id} className={`border-b border-slate-50 ${n.readAt ? "" : "bg-blue-50"}`}>
                  <button
                    type="button"
                    onClick={() => handleOpenNotification(n)}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-100"
                  >
                    <p className="font-medium text-slate-900">{n.title}</p>
                    <p className="text-xs text-slate-500">{n.message}</p>
                    <p className="mt-0.5 text-[10px] text-slate-400">{new Date(n.createdAt).toLocaleString()}</p>
                  </button>
                  {respondingTo === n.id && (
                    <div className="flex flex-col gap-1.5 px-3 pb-2.5">
                      <textarea
                        autoFocus
                        rows={2}
                        placeholder="Add a comment (optional)..."
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs"
                      />
                      {commentError && <p className="text-xs text-red-600">{commentError}</p>}
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => goToFinding(n)}
                          disabled={postingComment}
                          className="text-xs text-slate-500 hover:underline"
                        >
                          Skip
                        </button>
                        <button
                          type="button"
                          onClick={() => handlePostComment(n)}
                          disabled={postingComment}
                          className="rounded-md bg-brand-gold px-2 py-1 text-xs font-medium text-slate-900 hover:bg-brand-gold-dark disabled:opacity-60"
                        >
                          {postingComment ? "Posting..." : "Post Comment & View"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
