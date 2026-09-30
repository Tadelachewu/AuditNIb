import type { ReactNode } from "react";

/**
 * The action row (Save / Cancel / Submit ...) of any form or editor that can
 * be taller than the screen - Settings, the Add dialogs, inline editors, the
 * Register Finding form. It sticks to the bottom of whatever is scrolling
 * (the window, or a dialog's body), so the buttons are always reachable
 * without scrolling past the whole form first, and it carries the form's
 * error message so a failed save is never reported off-screen.
 *
 *   <StickyActions error={formError}>
 *     <Button variant="cancel" onClick={close}>Cancel</Button>
 *     <Button type="submit">Save</Button>
 *   </StickyActions>
 *
 * `variant`:
 *   card  (default) - edge-to-edge footer of a `p-4` container (a Card, an
 *                     Add/Edit dialog body): cancels that padding so it
 *                     reads as the container's own footer.
 *   inset           - a self-contained rounded bar, for containers with
 *                     other padding (an inline editor panel).
 *   page            - full-width bar along the bottom of the screen for a
 *                     whole page (Settings): cancels <main>'s `p-6`.
 *
 * Sticky needs every ancestor up to the scrolling element to not clip or
 * scroll on its own - which is why (app)/layout.tsx's <main> uses
 * overflow-x-clip, not overflow-x-auto (the latter silently makes <main>
 * a scroll container that never scrolls, and nothing inside could stick).
 */
const VARIANTS = {
  card: "-mx-4 -mb-4 rounded-b-lg px-4",
  inset: "rounded-md border px-3 shadow-sm",
  page: "-mx-6 -mb-6 px-6 shadow-[0_-4px_12px_-6px_rgb(15_23_42/0.15)]",
} as const;

export function StickyActions({
  children,
  error,
  hint,
  variant = "card",
  className = "",
}: {
  children: ReactNode;
  /** Shown at the left of the bar, in red. */
  error?: string | null;
  /** Neutral note at the left of the bar (e.g. why Submit is disabled). */
  hint?: ReactNode;
  variant?: keyof typeof VARIANTS;
  className?: string;
}) {
  return (
    <div
      className={`sticky bottom-0 z-20 col-span-full mt-2 flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-white/95 py-3 backdrop-blur-sm ${VARIANTS[variant]} ${className}`}
    >
      {/* The message takes the free space and wraps its own text; the buttons
          stay together as one group, so a long message never splits them
          (on a narrow screen the whole group moves below the message). */}
      {(error || hint) && (
        <div className="min-w-0 flex-1 basis-60 text-sm" role={error ? "alert" : undefined}>
          {error ? <p className="text-red-600">{error}</p> : <p className="text-xs text-slate-500">{hint}</p>}
        </div>
      )}
      <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">{children}</div>
    </div>
  );
}
