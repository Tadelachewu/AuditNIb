"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";

const SIZES = {
  md: { cls: "max-w-lg", px: 512 },
  lg: { cls: "max-w-2xl", px: 672 },
  xl: { cls: "max-w-4xl", px: 896 },
} as const;

const GAP = 10; // between the anchor button and the dialog (room for the arrow)
const EDGE = 16; // minimum distance from the viewport edges
const MIN_BELOW = 320; // below this much room under the button, open above it instead

// Open dialogs, oldest first: Escape closes only the top one (a confirmation
// opened over an Edit dialog closes alone, not both).
const openDialogs: symbol[] = [];

type Placement = {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
  above: boolean;
  /** Arrow's x offset inside the dialog, pointing at the button's centre. */
  arrowX: number;
};

/**
 * Generic dialog shell - same overlay/card look as useConfirm()'s dialog
 * (src/components/ui/ConfirmDialog.tsx), sized for a form. Closes on
 * Escape or the header's X; clicking the backdrop deliberately does NOT
 * close it, so a stray click can't throw away a half-filled form.
 *
 * Two placements:
 *  - `anchor` given (every Add dialog): opens right next to the button
 *    that opened it - just below it, right edges aligned, with a small
 *    arrow pointing back at the button - instead of in the middle of the
 *    screen, far from where the user clicked. Flips above the button when
 *    there isn't room below, stays inside the viewport edges, and scales
 *    in from the button's corner.
 *  - no anchor (the Users/Departments Edit dialogs, opened from a row
 *    menu that's already closed): centred, as usual.
 * Either way tall forms scroll inside the dialog (their StickyActions
 * footer stays pinned) instead of past the viewport.
 *
 * THE one dialog look for the whole app - Add, Edit, Import and every
 * confirmation (useConfirm) use it: header with title + X, body `p-4`,
 * actions in a <StickyActions> footer. Don't build another overlay.
 */
export function Modal({
  title,
  description,
  size = "lg",
  anchor,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  size?: keyof typeof SIZES;
  /** The element (the Add button) to open next to; omit to centre. */
  anchor?: HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Placement | null>(null);
  const [shown, setShown] = useState(false);
  // Latest onClose without re-running the mount effect below on every
  // render (which would steal focus back to the first field mid-typing).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Anchored placement: measured before paint, re-measured on resize.
  useLayoutEffect(() => {
    if (!anchor) return;
    const el = anchor;
    function measure() {
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.min(SIZES[size].px, vw - EDGE * 2);
      // Right edge lines up with the button's right edge, clamped on-screen.
      const left = Math.min(Math.max(EDGE, r.right - width), vw - EDGE - width);
      const roomBelow = vh - r.bottom - GAP - EDGE;
      const roomAbove = r.top - GAP - EDGE;
      const above = roomBelow < MIN_BELOW && roomAbove > roomBelow;
      const arrowX = Math.min(Math.max(20, r.left + r.width / 2 - left), width - 20);
      setPlace(
        above
          ? { left, width, above, arrowX, bottom: vh - r.top + GAP, maxHeight: roomAbove }
          : { left, width, above, arrowX, top: r.bottom + GAP, maxHeight: roomBelow }
      );
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [anchor, size]);

  useEffect(() => {
    const me = Symbol("dialog");
    openDialogs.push(me);
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && openDialogs[openDialogs.length - 1] === me) {
        e.stopPropagation();
        onCloseRef.current();
      }
    }
    document.addEventListener("keydown", onKey);
    // Lock page scroll behind the dialog, restoring whatever it was.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // First field, else an element marked data-autofocus (e.g. a confirmation's Cancel).
    (
      panelRef.current?.querySelector<HTMLElement>("input, select, textarea") ??
      panelRef.current?.querySelector<HTMLElement>("[data-autofocus]")
    )?.focus();
    // Next frame: flip to the "shown" state so the enter transition runs.
    const raf = requestAnimationFrame(() => setShown(true));
    return () => {
      openDialogs.splice(openDialogs.indexOf(me), 1);
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  const anchored = Boolean(anchor);
  const header = (
    <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
      </div>
      <button
        type="button"
        onClick={() => onCloseRef.current()}
        aria-label="Close"
        className="-mr-1 rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
  const enter = `transition duration-150 ease-out ${shown ? "opacity-100 scale-100" : "opacity-0 scale-95"}`;

  if (anchored) {
    return createPortal(
      <div className={`fixed inset-0 z-50 bg-slate-900/25 transition-opacity duration-150 ${shown ? "opacity-100" : "opacity-0"}`}>
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          style={{
            position: "fixed",
            left: place?.left ?? -9999,
            top: place?.top,
            bottom: place?.bottom,
            width: place?.width,
            maxHeight: place?.maxHeight,
            // Hidden until measured, so it never flashes in the wrong spot.
            visibility: place ? "visible" : "hidden",
            transformOrigin: place?.above ? "bottom right" : "top right",
          }}
          className={`flex flex-col rounded-lg bg-white shadow-2xl ring-1 ring-slate-900/10 ${enter}`}
        >
          {/* Arrow pointing back at the button that opened the dialog. */}
          {place && (
            <span
              aria-hidden
              style={{ left: place.arrowX - 6 }}
              className={`absolute h-3 w-3 rotate-45 bg-white ring-1 ring-slate-900/10 ${
                place.above ? "-bottom-1.5 [clip-path:polygon(100%_0,100%_100%,0_100%)]" : "-top-1.5 [clip-path:polygon(0_0,100%_0,0_100%)]"
              }`}
            />
          )}
          {header}
          <div className="overflow-y-auto">{children}</div>
        </div>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div className={`fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/25 p-4 transition-opacity duration-150 sm:items-center ${shown ? "opacity-100" : "opacity-0"}`}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        // Same backdrop, shadow and border as the anchored (Add) dialog - one look for every dialog.
        className={`flex max-h-[calc(100vh-2rem)] w-full flex-col rounded-lg bg-white shadow-2xl ring-1 ring-slate-900/10 ${SIZES[size].cls} ${enter}`}
      >
        {header}
        <div className="overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body
  );
}

/**
 * The one "Add <thing>" entry point every admin list uses: a gold button
 * placed in the list card's header (top right, via CardHeader's `action`)
 * that opens the create form in a Modal anchored right under it.
 * `children` is a render function receiving `close`, so a form can dismiss
 * the dialog after a successful create:
 *   <CardHeader title="All Districts" action={canCreate && (
 *     <AddDialog title="Add District">{({ close }) => <form onSubmit={...close()}>}</AddDialog>
 *   )} />
 */
export function AddDialog({
  title,
  description,
  buttonLabel,
  size = "lg",
  children,
}: {
  title: string;
  description?: string;
  /** Defaults to the dialog title. */
  buttonLabel?: string;
  size?: keyof typeof SIZES;
  children: (helpers: { close: () => void }) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // The button element itself (via a callback ref), so the dialog can be
  // positioned next to it and focus can return to it on close.
  const [button, setButton] = useState<HTMLButtonElement | null>(null);
  const close = () => {
    setOpen(false);
    // Return focus to the button, where the user started.
    button?.focus();
  };
  return (
    <>
      <Button ref={setButton} type="button" onClick={() => setOpen(true)} className="shrink-0" aria-expanded={open}>
        <Plus className="h-4 w-4" strokeWidth={2.5} />
        {buttonLabel ?? title}
      </Button>
      {open && (
        <Modal title={title} description={description} size={size} anchor={button} onClose={close}>
          {children({ close })}
        </Modal>
      )}
    </>
  );
}
