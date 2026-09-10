"use client";

import { useEffect, useState } from "react";

type ThemeChoice = "system" | "light" | "dark";

const STORAGE_KEY = "theme";
const CYCLE: ThemeChoice[] = ["system", "light", "dark"];

function apply(choice: ThemeChoice) {
  if (choice === "system") {
    document.documentElement.removeAttribute("data-theme");
    localStorage.removeItem(STORAGE_KEY);
  } else {
    document.documentElement.setAttribute("data-theme", choice);
    localStorage.setItem(STORAGE_KEY, choice);
  }
}

const ICON: Record<ThemeChoice, React.ReactNode> = {
  // Monitor - "Following your system setting."
  system: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  ),
  // Sun - "Light, always."
  light: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  ),
  // Moon - "Dark, always."
  dark: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
    </svg>
  ),
};

const LABEL: Record<ThemeChoice, string> = { system: "System", light: "Light", dark: "Dark" };

/**
 * One button, cycling System -> Light -> Dark -> System, matching
 * NotificationBell's icon-button footprint in the Topbar rather than a
 * separate settings screen - a per-browser preference (localStorage, not
 * tied to the account) is exactly the kind of thing worth one click away
 * everywhere, not buried in Profile. See globals.css's dark-mode block and
 * layout.tsx's THEME_INIT_SCRIPT for the other two-thirds of this feature -
 * this component only ever reads/writes the same "theme" localStorage key
 * and the same data-theme attribute those rely on.
 */
export function ThemeToggle() {
  // Starts "system" on the server and on the client's first paint alike
  // (matching THEME_INIT_SCRIPT's own default of touching nothing until it
  // finds an explicit choice) - reading the real value only after mount
  // avoids a hydration mismatch from localStorage, which the server has no
  // access to at all.
  const [choice, setChoice] = useState<ThemeChoice>("system");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") setChoice(stored);
  }, []);

  function cycle() {
    const next = CYCLE[(CYCLE.indexOf(choice) + 1) % CYCLE.length];
    setChoice(next);
    apply(next);
  }

  return (
    <button
      type="button"
      onClick={cycle}
      className="rounded-full p-2 text-on-dark/70 hover:bg-on-dark/10 hover:text-on-dark"
      aria-label={`Theme: ${LABEL[choice]}. Click to change.`}
      title={`Theme: ${LABEL[choice]}`}
    >
      <span className="block h-5 w-5">{ICON[choice]}</span>
    </button>
  );
}
