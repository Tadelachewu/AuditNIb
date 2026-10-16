"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { apiGet } from "@/lib/api-client";

const POLL_MS = 30_000;

/**
 * Unread Communications count on the sidebar item (docs/communications.md).
 * Polls at the notification bell's 30-second cadence, as a background request
 * (so it never counts as user activity), and again whenever the page changes -
 * opening a message updates it straight away. Hidden at 0.
 */
export function UnreadCommunicationsBadge() {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () =>
      apiGet<{ unread: number }>("/api/communications/unread-count", { background: true })
        .then((r) => alive && setUnread(r.unread))
        .catch(() => {});
    load();
    const timer = window.setInterval(load, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [pathname]);

  if (unread <= 0) return null;
  const text = unread > 99 ? "99+" : String(unread);
  return (
    <>
      <span
        className="ml-auto rounded-full bg-sky-600 px-1.5 py-px text-[11px] font-semibold leading-4 text-on-dark sidebar-collapsed:hidden"
        aria-label={`${unread} unread`}
      >
        {text}
      </span>
      {/* Collapsed rail: a dot on the icon instead of the count. */}
      <span className="absolute right-1.5 top-1 hidden h-2 w-2 rounded-full bg-sky-600 sidebar-collapsed:block" aria-hidden="true" />
    </>
  );
}
