"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_SECTIONS, isNavItemVisible } from "@/lib/nav";
import type { Role } from "@/types";

export function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname();

  return (
    <nav className="flex w-60 shrink-0 flex-col gap-5 border-r border-slate-200 bg-white px-3 py-5">
      <div className="px-2">
        <p className="text-sm font-bold text-blue-900">NIB Control360</p>
        <p className="text-xs text-slate-400">Findings Management</p>
      </div>

      {NAV_SECTIONS.map((section) => {
        const items = section.items.filter((item) => isNavItemVisible(item, role));
        if (items.length === 0) return null;
        return (
          <div key={section.label}>
            <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              {section.label}
            </p>
            <div className="flex flex-col gap-0.5">
              {items.map((item) => {
                const active = pathname === item.href || (item.href !== "/dashboard" && item.href !== "/admin" && pathname.startsWith(item.href));
                const exactAdmin = item.href === "/admin" && pathname === "/admin";
                const isActive = item.href === "/admin" ? exactAdmin : active;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                      isActive
                        ? "bg-blue-50 font-medium text-blue-900"
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
