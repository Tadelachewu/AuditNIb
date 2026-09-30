"use client";

import { useEffect, useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

/**
 * Collapses the sidebar to an icon rail / expands it. The state lives on <html data-sidebar>
 * (restored before first paint by the init script in app/layout.tsx, so the
 * sidebar never flashes) and in localStorage ("sidebar"); the sidebar reacts
 * through the `sidebar-collapsed:` CSS variant in globals.css.
 * Keyboard: Ctrl+B (⌘B on Mac), like most modern apps.
 */
const ATTR = "data-sidebar";

function isHidden(): boolean {
  return typeof document !== "undefined" && document.documentElement.getAttribute(ATTR) === "collapsed";
}

function setHidden(hidden: boolean) {
  const root = document.documentElement;
  if (hidden) root.setAttribute(ATTR, "collapsed");
  else root.removeAttribute(ATTR);
  try {
    localStorage.setItem("sidebar", hidden ? "collapsed" : "expanded");
  } catch {
    // Private mode etc. - it just won't be remembered.
  }
}

export function SidebarToggle() {
  // false on the server and first client render (same markup); synced from
  // <html> right after mount.
  const [hidden, setHiddenState] = useState(false);

  useEffect(() => {
    setHiddenState(isHidden());
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
        const target = e.target as HTMLElement | null;
        if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
        e.preventDefault();
        const next = !isHidden();
        setHidden(next);
        setHiddenState(next);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function toggle() {
    const next = !isHidden();
    setHidden(next);
    setHiddenState(next);
  }

  const label = hidden ? "Expand sidebar" : "Collapse sidebar";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      aria-controls="app-sidebar"
      aria-expanded={!hidden}
      title={`${label} (Ctrl+B)`}
      className="group inline-flex h-9 w-9 items-center justify-center rounded-lg text-chrome-muted ring-1 ring-transparent transition-all hover:bg-chrome-hover hover:text-chrome-fg hover:ring-chrome-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold active:scale-95"
    >
      {hidden ? (
        <PanelLeftOpen className="h-[18px] w-[18px] transition-transform group-hover:translate-x-0.5" strokeWidth={1.75} />
      ) : (
        <PanelLeftClose className="h-[18px] w-[18px] transition-transform group-hover:-translate-x-0.5" strokeWidth={1.75} />
      )}
    </button>
  );
}
