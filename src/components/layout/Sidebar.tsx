"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_SECTIONS, isNavItemVisible } from "@/lib/nav";

export function Sidebar({ permissions, role }: { permissions: string[]; role: string }) {
  const pathname = usePathname();

  return (
    // Sticky to the viewport, same as Topbar - the sidebar itself never
    // scrolls out of view as the page scrolls. h-screen + its own
    // overflow-y-auto means a nav list taller than the viewport (e.g. the
    // full Administration section) scrolls *inside* the sidebar instead of
    // growing the whole page, which is what makes the inner logo sticky
    // (below) meaningful - without an independent scroll container here,
    // there'd be nothing for it to stay pinned above.
    <nav className="sidebar-scroll sticky top-0 flex h-screen w-60 shrink-0 flex-col overflow-y-auto bg-brand-sidebar">
      {/* Sticky within the nav's own scroll, not the page's - stays
          pinned to the top of the sidebar while the nav sections below
          scroll underneath it, the same "always visible" behavior Topbar
          has relative to the page. Needs its own solid background and a
          z-index so scrolling nav items actually disappear behind it
          instead of showing through. */}
      <div className="sticky top-0 z-10 flex shrink-0 items-center gap-2.5 bg-brand-sidebar px-5 py-5">
        <Image
          src="/Nib_International_Bank.png"
          alt="NIB International Bank"
          width={34}
          height={34}
          className="shrink-0"
        />
        <div>
          <p className="text-sm font-bold text-on-dark">NIB Control360</p>
          <p className="text-xs text-on-dark/50">Findings Management</p>
        </div>
      </div>

      <div className="flex flex-col gap-5 px-3 pb-5">
        {NAV_SECTIONS.map((section) => {
          const items = section.items.filter((item) => isNavItemVisible(item, permissions, role));
          if (items.length === 0) return null;
          return (
            <div key={section.label}>
              <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-on-dark/40">
                {section.label}
              </p>
              <div className="flex flex-col gap-0.5">
                {items.map((item) => {
                  const active = pathname === item.href || (item.href !== "/dashboard" && item.href !== "/admin" && pathname.startsWith(item.href));
                  const exactAdmin = item.href === "/admin" && pathname === "/admin";
                  const isActive = item.href === "/admin" ? exactAdmin : active;
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                        isActive
                          ? "bg-brand-gold font-medium text-on-gold"
                          : "text-on-dark/70 hover:bg-brand-gold hover:text-on-gold"
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
