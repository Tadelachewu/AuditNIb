"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";

const SIZES = {
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
} as const;

/**
 * Generic modal shell - same overlay/card look as useConfirm()'s dialog
 * (src/components/ui/ConfirmDialog.tsx), sized for a form. Closes on
 * Escape or the header's X; clicking the backdrop deliberately does NOT
 * close it, so a stray click can't throw away a half-filled form. Tall
 * forms scroll inside the dialog instead of past the viewport.
 */
export function Modal({
  title,
  description,
  size = "lg",
  onClose,
  children,
}: {
  title: string;
  description?: string;
  size?: keyof typeof SIZES;
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Latest onClose without re-running the mount effect below on every
  // render (which would steal focus back to the first field mid-typing).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCloseRef.current();
    }
    document.addEventListener("keydown", onKey);
    // Lock page scroll behind the dialog, restoring whatever it was.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("input, select, textarea")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:items-center">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`flex max-h-[calc(100vh-2rem)] w-full flex-col rounded-lg bg-white shadow-xl ${SIZES[size]}`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body
  );
}

/**
 * The one "Add <thing>" entry point every admin list uses: a gold button
 * placed in the list card's header (top right, via CardHeader's `action`)
 * that opens the create form in a Modal. `children` is a render function
 * receiving `close`, so a form can dismiss the dialog after a successful
 * create:
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
  const close = () => setOpen(false);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)} className="shrink-0">
        <Plus className="h-4 w-4" strokeWidth={2.5} />
        {buttonLabel ?? title}
      </Button>
      {open && (
        <Modal title={title} description={description} size={size} onClose={close}>
          {children({ close })}
        </Modal>
      )}
    </>
  );
}
