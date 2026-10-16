"use client";

import { useTransition, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * A report template's filter row that applies itself: choosing a period,
 * district or date updates the report at once - no "View" button. Sends the
 * same query string the plain GET form did, as a client-side navigation
 * (the page re-renders on the server, keeping the scroll position). Enter
 * in a field also applies it.
 */
export function AutoFilterForm({ className, children }: { className?: string; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function apply(form: HTMLFormElement) {
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(form)) {
      if (typeof value === "string") params.append(key, value);
    }
    const query = params.toString();
    startTransition(() => router.push(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  }

  return (
    <form
      method="GET"
      className={className}
      aria-busy={pending}
      onChange={(e) => apply(e.currentTarget)}
      onSubmit={(e) => {
        e.preventDefault();
        apply(e.currentTarget);
      }}
    >
      {children}
      {pending && <span className="pb-2 text-xs text-slate-500">Updating…</span>}
    </form>
  );
}
