"use client";

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
export function AppToaster() {
  return (
    <Toaster
      position={NOTIFY_POSITION}
      offset={NOTIFY_OFFSET}
      visibleToasts={NOTIFY_MAX_VISIBLE}
      richColors
      closeButton
      theme="system"
      containerAriaLabel="Notifications"
      toastOptions={{ closeButtonAriaLabel: "Dismiss notification" }}
    />
  );
}
