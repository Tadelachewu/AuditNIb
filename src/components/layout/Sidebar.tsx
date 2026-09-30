"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_SECTIONS, isNavItemVisible } from "@/lib/nav";

/**
 * Hideable: SidebarToggle (top bar, or Ctrl+B) hides the whole sidebar -
 * <html data-sidebar="collapsed"> + the `sidebar-collapsed:` CSS variant
 * (globals.css), so server and client render the same markup and the
 * page simply takes the full width.
 */
export function Sidebar({ permissions, role }: { permissions: string[]; role: string }) {
  const pathname = usePathname();

  return (
    // Sticky to the viewport, same as Topbar - the sidebar itself never
    // scrolls out of view as the page scrolls. h-screen + its own
    // overflow-y-auto means a nav list taller than the viewport scrolls
    // *inside* the sidebar instead of growing the whole page.
    <nav
      id="app-sidebar"
      aria-label="Main navigation"
      className="sidebar-scroll sticky top-0 flex h-screen w-60 shrink-0 flex-col overflow-y-auto overflow-x-hidden border-r border-chrome-border bg-chrome-bg sidebar-collapsed:hidden"
    >
      {/* Pinned to the top of the sidebar's own scroll. */}
      <div className="sticky top-0 z-10 flex shrink-0 items-center gap-2.5 bg-chrome-bg px-5 py-5">
        <Image src="/Nib_International_Bank.png" alt="NIB International Bank" width={34} height={34} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold leading-tight text-chrome-fg">NIB Control360</p>
          <p className="text-xs text-chrome-muted">Findings Management</p>
        </div>
      </div>

      <div className="flex flex-col gap-5 px-3 pb-5">
        {NAV_SECTIONS.map((section, i) => {
          const items = section.items.filter((item) => isNavItemVisible(item, permissions, role));
          if (items.length === 0) return null;
          return (
            <div key={section.label ?? i}>
              {section.label && (
                <p className="px-2 pb-1.5 text-xs font-semibold uppercase tracking-wider text-chrome-accent">{section.label}</p>
              )}
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
                      aria-current={isActive ? "page" : undefined}
                      className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                        isActive ? "bg-brand-gold font-semibold text-on-gold" : "text-chrome-fg hover:bg-chrome-hover"
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                      <span className="truncate">{item.label}</span>
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
