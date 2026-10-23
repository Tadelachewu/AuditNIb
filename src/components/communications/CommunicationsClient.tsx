"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Paperclip, PenSquare, Search } from "lucide-react";
import { apiGet } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { ForwardedLabel } from "./ForwardedLabel";
import { Pagination } from "@/components/ui/Pagination";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { notifications, presentError } from "@/lib/notify";
import type { InboxItem, SentItem } from "@/lib/communications/types";

type Box = "inbox" | "sent";
const POLL_MS = 30_000;

/**
 * Communications home (docs/communications.md): Inbox (messages to me,
 * unread in bold) and Sent (with how many have read each), searchable and
 * paged, refreshed every 30 seconds like the notification bell.
 */
export function CommunicationsClient({ canSend }: { canSend: boolean }) {
  const [box, setBox] = useState<Box>("inbox");
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<{ items: (InboxItem | SentItem)[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (background: boolean) => {
      try {
        const params = new URLSearchParams({ box, page: String(page), pageSize: String(DEFAULT_PAGE_SIZE) });
        if (search) params.set("q", search);
        setData(await apiGet<{ items: (InboxItem | SentItem)[]; total: number }>(`/api/communications?${params}`, { background }));
        setError(null);
      } catch (err) {
        setError(presentError(err, notifications.communications.loadFailed).message);
      }
    },
    [box, page, search]
  );

  useEffect(() => {
    void load(false);
    const timer = window.setInterval(() => void load(true), POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  // Search applies after a short pause in typing.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch(q.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(t);
  }, [q]);

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / DEFAULT_PAGE_SIZE));
  const tab = (b: Box, label: string) => (
    <button
      type="button"
      onClick={() => {
        setBox(b);
        setPage(1);
        setData(null);
      }}
      className={`rounded-md px-3 py-1.5 text-sm font-semibold ${box === b ? "bg-sky-100 text-sky-900" : "text-slate-600 hover:bg-slate-100"}`}
      aria-pressed={box === b}
    >
      {label}
    </button>
  );

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
        {tab("inbox", "Inbox")}
        {tab("sent", "Sent")}
        <div className="relative ml-auto w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search subject, sender or text" className="pl-8" aria-label="Search messages" />
        </div>
        {canSend && (
          <Link href="/communications/new" className="inline-flex items-center gap-1.5 rounded-md bg-brand-gold px-3 py-1.5 text-sm font-medium text-on-gold hover:bg-brand-gold-dark">
            <PenSquare className="h-4 w-4" />
            New message
          </Link>
        )}
      </div>

      {error && <p className="p-4 text-sm text-red-600">{error}</p>}
      {!data && !error && (
        <div className="p-4">
          <ListSkeleton />
        </div>
      )}
      {data && data.items.length === 0 && (
        <p className="p-6 text-center text-sm text-slate-500">{search ? "No messages match your search." : box === "inbox" ? "No messages yet." : "You haven't sent any messages yet."}</p>
      )}
      {data && data.items.length > 0 && (
        <ul className="flex flex-col gap-2 p-3" aria-label="Messages">
          {data.items.map((m) => (box === "inbox" ? <InboxRow key={m.id} m={m as InboxItem} /> : <SentRow key={m.id} m={m as SentItem} />))}
        </ul>
      )}
      {data && (
        <div className="border-t border-slate-200 p-3">
          <Pagination page={page} totalPages={totalPages} total={data.total} pageSize={DEFAULT_PAGE_SIZE} onPageChange={setPage} />
        </div>
      )}
    </Card>
  );
}

/**
 * Inbox / Sent rows: a soft gold tint (alternating), and on hover the New
 * message button's own gold with its dark text (text-on-gold stays dark in
 * both themes, so the row stays readable). Unread rows: a stronger tint and
 * a dark-gold edge. Keyboard focus matches.
 */
const ROW =
  "flex items-start gap-3 border-l-4 px-4 py-3 transition-colors hover:border-brand-gold-dark hover:bg-brand-gold hover:[&_*]:text-on-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-gold-dark";
const UNREAD_ROW = "border-brand-gold-dark bg-brand-gold/25";
const READ_ROW = "border-transparent";

function InboxRow({ m }: { m: InboxItem }) {
  const unread = !m.readAt;
  return (
    <li className="overflow-hidden rounded-md border border-slate-200 shadow-sm odd:bg-white even:bg-slate-50">
      <Link href={`/communications/${m.id}`} className={`${ROW} ${unread ? UNREAD_ROW : READ_ROW}`}>
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${unread ? "bg-brand-gold-dark" : "bg-transparent"}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className={`truncate text-sm ${unread ? "font-semibold text-slate-900" : "text-slate-700"}`}>
              <span className="text-xs font-semibold text-slate-600">From:</span> {m.senderName}
            </span>
            <span className="ml-auto shrink-0 text-xs text-slate-500">{formatDateTime(m.createdAt)}</span>
          </div>
          <p className={`truncate text-sm ${unread ? "font-semibold text-slate-900" : "text-slate-800"}`}>
            {m.forwarded && <ForwardedLabel className="mr-1.5" />}
            {m.subject}
            {m.attachmentCount > 0 && <Paperclip className="ml-1 inline h-3.5 w-3.5 text-slate-500" aria-label={`${m.attachmentCount} attachment(s)`} />}
          </p>
          <p className="truncate text-xs text-slate-500">{m.preview}</p>
        </div>
        {unread && <span className="sr-only">Unread</span>}
      </Link>
    </li>
  );
}

function SentRow({ m }: { m: SentItem }) {
  const to = m.toAll ? `All users (${m.recipientCount})` : m.recipientCount <= m.recipientNames.length ? m.recipientNames.join(", ") : `${m.recipientNames.join(", ")} +${m.recipientCount - m.recipientNames.length} more`;
  return (
    <li className="overflow-hidden rounded-md border border-slate-200 shadow-sm odd:bg-white even:bg-slate-50">
      <Link href={`/communications/${m.id}`} className={`${ROW} ${READ_ROW}`}>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-sm text-slate-700">
              <span className="text-xs font-semibold text-slate-600">To:</span> {to}
            </span>
            <span className="ml-auto shrink-0 text-xs text-slate-500">{formatDateTime(m.createdAt)}</span>
          </div>
          <p className="truncate text-sm text-slate-900">
            {m.forwarded && <ForwardedLabel className="mr-1.5" />}
            {m.subject}
            {m.attachmentCount > 0 && <Paperclip className="ml-1 inline h-3.5 w-3.5 text-slate-500" aria-label={`${m.attachmentCount} attachment(s)`} />}
          </p>
          <p className="truncate text-xs text-slate-500">{m.preview}</p>
        </div>
        <div className="shrink-0 pt-0.5">
          {m.withdrawnAt ? <Badge tone="gray">Withdrawn</Badge> : <Badge tone={m.readCount === m.recipientCount ? "green" : "blue"}>Read {m.readCount}/{m.recipientCount}</Badge>}
        </div>
      </Link>
    </li>
  );
}
