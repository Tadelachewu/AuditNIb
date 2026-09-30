"use client";

import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { NOTIFY_MAX_VISIBLE, NOTIFY_OFFSET, NOTIFY_POSITION } from "@/lib/notify/config";

/**
 * The single notification outlet, mounted once in the root layout. All
 * look & behaviour comes from src/lib/notify/config.ts; components raise
 * notifications only through `notify` (src/lib/notify).
 *
 * Accessibility (Sonner): toasts are announced through a polite aria-live
 * region; each type has its own icon as well as colour (never colour
 * alone); every toast has a labelled close button; hovering or focusing
 * pauses the timer; Alt+T moves focus to the notifications; animation is
 * disabled under prefers-reduced-motion.
 */
/** The app's own theme: <html data-theme> when the user picked one, else the OS setting. */
function useAppTheme(): "light" | "dark" | "system" {
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");
  useEffect(() => {
    const read = () => {
      const t = document.documentElement.getAttribute("data-theme");
      setTheme(t === "light" || t === "dark" ? t : "system");
    };
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

export function AppToaster() {
  // Follows the app's Light/Dark switch, not only the OS setting.
  const theme = useAppTheme();
  return (
    <Toaster
      position={NOTIFY_POSITION}
      offset={NOTIFY_OFFSET}
      visibleToasts={NOTIFY_MAX_VISIBLE}
      richColors
      closeButton
      theme={theme}
      containerAriaLabel="Notifications"
      toastOptions={{ closeButtonAriaLabel: "Dismiss notification" }}
    />
  );
}
