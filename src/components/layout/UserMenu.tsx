"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, KeyRound, LogOut, UserCircle } from "lucide-react";
import { apiSend } from "@/lib/api-client";

/** Fired instead of navigating when "Change Password" is picked while already on /profile. */
export const OPEN_CHANGE_PASSWORD_EVENT = "open-change-password";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}

/**
 * The topbar's account control: an avatar (the user's initials on brand
 * gold) that opens a menu with My Profile, Change Password and Log out.
 * Replaces the old name link + separate Sign out button, so the account
 * actions live in one predictable place. Change Password links to
 * /profile?section=change-password, whose section opens itself on arrival
 * (see ProfileClient) - or, when already on /profile, signals it to open
 * in place via OPEN_CHANGE_PASSWORD_EVENT.
 */
export function UserMenu({ name, roleName }: { name: string; roleName?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function logOut() {
    setSigningOut(true);
    try {
      await apiSend("/api/auth/logout", "POST");
      router.push("/login");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }

  const itemClass =
    "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-100";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${name}`}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-full p-0.5 pr-1.5 text-chrome-fg transition-colors hover:bg-chrome-hover"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-gold text-xs font-semibold text-on-gold ring-2 ring-chrome-border">
          {initials(name)}
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={2} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          <div className="border-b border-slate-100 px-3 py-2.5">
            <p className="truncate text-sm font-semibold text-slate-900">{name}</p>
            {roleName && <p className="truncate text-xs text-slate-500">{roleName}</p>}
          </div>
          <Link href="/profile" role="menuitem" className={itemClass} onClick={() => setOpen(false)}>
            <UserCircle className="h-4 w-4 shrink-0 text-slate-500" strokeWidth={2} />
            My Profile
          </Link>
          <Link
            href="/profile?section=change-password"
            role="menuitem"
            className={itemClass}
            onClick={(e) => {
              setOpen(false);
              // Already on the Profile page: just open the section in place.
              if (pathname === "/profile") {
                e.preventDefault();
                window.dispatchEvent(new Event(OPEN_CHANGE_PASSWORD_EVENT));
              }
            }}
          >
            <KeyRound className="h-4 w-4 shrink-0 text-slate-500" strokeWidth={2} />
            Change Password
          </Link>
          <div role="separator" className="my-1 border-t border-slate-100" />
          <button
            type="button"
            role="menuitem"
            disabled={signingOut}
            onClick={logOut}
            className={`${itemClass} text-red-700 hover:bg-red-50 disabled:opacity-50`}
          >
            <LogOut className="h-4 w-4 shrink-0 text-red-600" strokeWidth={2} />
            {signingOut ? "Logging out..." : "Log out"}
          </button>
        </div>
      )}
    </div>
  );
}
