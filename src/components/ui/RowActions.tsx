"use client";

import {
  Children,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  Pencil,
  Trash2,
  Power,
  PowerOff,
  Check,
  X,
  Eye,
  Lock,
  LockOpen,
  Copy,
  Star,
  StarOff,
  RotateCcw,
  KeyRound,
  type LucideIcon,
} from "lucide-react";

// One pattern for every per-row action in every admin list: a single
// "Actions" button per row that opens a menu of that row's actions (Edit,
// Activate/Deactivate, Delete, ...), so a table never turns into a wall of
// buttons and every page offers its row actions in the same place, the
// same way. The same action is always the same icon and color:
//   neutral (slate)  - edit / view / other non-state-changing actions
//   green            - activate / unlock
//   amber            - deactivate / lock (reversible)
//   red              - delete (permanent; always last, below a divider)
//
// Usage - a page lists its actions as <RowAction> children; <RowActions>
// turns them into the menu:
//   <RowActions>
//     {canEdit && <RowAction kind="edit" onClick={...} />}
//     {canToggle && <StatusToggleAction active={...} onClick={...} />}
//     {canDelete && <RowAction kind="delete" onClick={...} />}
//   </RowActions>
// `<RowActions inline>` renders the same children as compact buttons in a
// row instead - used only for an inline edit's Cancel/Save pair, which has
// to stay visible next to the field being edited.

export type RowActionKind =
  | "edit"
  | "view"
  | "save"
  | "cancel"
  | "activate"
  | "deactivate"
  | "delete"
  | "lock"
  | "unlock"
  | "duplicate"
  | "default"
  | "undefault"
  | "reset"
  | "password";

type Tone = "neutral" | "cancel" | "success" | "warning" | "danger" | "primary";

const PRESETS: Record<RowActionKind, { label: string; icon: LucideIcon; tone: Tone }> = {
  edit: { label: "Edit", icon: Pencil, tone: "neutral" },
  view: { label: "View", icon: Eye, tone: "neutral" },
  save: { label: "Save", icon: Check, tone: "primary" },
  cancel: { label: "Cancel", icon: X, tone: "cancel" },
  activate: { label: "Activate", icon: Power, tone: "success" },
  deactivate: { label: "Deactivate", icon: PowerOff, tone: "warning" },
  delete: { label: "Delete", icon: Trash2, tone: "danger" },
  lock: { label: "Lock", icon: Lock, tone: "warning" },
  unlock: { label: "Unlock", icon: LockOpen, tone: "success" },
  duplicate: { label: "Duplicate", icon: Copy, tone: "neutral" },
  default: { label: "Set as default", icon: Star, tone: "neutral" },
  undefault: { label: "Unset default", icon: StarOff, tone: "neutral" },
  reset: { label: "Reset", icon: RotateCcw, tone: "neutral" },
  password: { label: "Reset password", icon: KeyRound, tone: "neutral" },
};

// Compact inline buttons (the <RowActions inline> Cancel/Save pair).
// Theme-remapped slate/emerald/amber/red tokens (see globals.css), so each
// tone keeps its meaning and contrast in dark mode too.
const BUTTON_TONES: Record<Tone, string> = {
  neutral: "border-slate-300 text-slate-700 hover:bg-slate-100",
  // Same soft grey fill as Button's `cancel` variant.
  cancel: "border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200",
  success: "border-emerald-300 text-emerald-700 hover:bg-emerald-50",
  warning: "border-amber-300 text-amber-700 hover:bg-amber-50",
  danger: "border-red-300 text-red-700 hover:bg-red-50",
  primary: "border-brand-gold bg-brand-gold text-on-gold hover:bg-brand-gold-dark",
};

// Menu items: text + icon color only; the whole row highlights on hover.
const ITEM_TONES: Record<Tone, { text: string; icon: string; hover: string }> = {
  neutral: { text: "text-slate-700", icon: "text-slate-500", hover: "hover:bg-slate-100" },
  cancel: { text: "text-slate-700", icon: "text-slate-500", hover: "hover:bg-slate-100" },
  primary: { text: "text-slate-900", icon: "text-brand-gold-dark", hover: "hover:bg-slate-100" },
  success: { text: "text-emerald-700", icon: "text-emerald-600", hover: "hover:bg-emerald-50" },
  warning: { text: "text-amber-700", icon: "text-amber-600", hover: "hover:bg-amber-50" },
  danger: { text: "text-red-700", icon: "text-red-600", hover: "hover:bg-red-50" },
};

const MenuContext = createContext<{ close: () => void } | null>(null);

export function RowAction({
  kind,
  label,
  icon,
  busy = false,
  className = "",
  onClick,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  kind: RowActionKind;
  /** Overrides the preset label (e.g. "Saving...", "Rename"). */
  label?: string;
  icon?: LucideIcon;
  /** Disables the action and shows a pulsing state while its request runs. */
  busy?: boolean;
}) {
  const menu = useContext(MenuContext);
  const preset = PRESETS[kind];
  const Icon = icon ?? preset.icon;
  const text = label ?? preset.label;
  const disabled = busy || props.disabled;

  if (menu) {
    const tone = ITEM_TONES[preset.tone];
    return (
      <>
        {kind === "delete" && <div role="separator" className="my-1 border-t border-slate-100" />}
        <button
          type="button"
          role="menuitem"
          {...props}
          disabled={disabled}
          onClick={(e) => {
            menu.close();
            onClick?.(e);
          }}
          className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent ${tone.text} ${tone.hover} ${className}`}
        >
          <Icon className={`h-4 w-4 shrink-0 ${tone.icon}`} strokeWidth={2} />
          <span className="whitespace-nowrap">{text}</span>
        </button>
      </>
    );
  }

  return (
    <button
      type="button"
      title={text}
      {...props}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        busy ? "animate-pulse" : ""
      } ${BUTTON_TONES[preset.tone]} ${className}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
      {text}
    </button>
  );
}

const MENU_WIDTH = 192; // w-48
const MENU_GAP = 4;

/**
 * A row's action menu (default), or an inline button group (`inline`).
 * The menu is portalled to <body> with fixed positioning: admin tables sit
 * inside `overflow-x-auto` wrappers, which would otherwise clip a dropdown
 * that extends past the table's bottom edge. It opens upward when there
 * isn't room below, and closes on outside click, Escape, scroll or resize
 * (a fixed menu would otherwise drift away from its row).
 */
export function RowActions({
  children,
  inline = false,
  label = "Actions",
  className = "",
}: {
  children: ReactNode;
  inline?: boolean;
  label?: string;
  className?: string;
}) {
  const items = Children.toArray(children).filter(Boolean);
  // Any child mid-request -> the trigger pulses, since the menu itself is
  // closed by then and can't show it.
  const busy = items.some((c) => isValidElement<{ busy?: boolean }>(c) && c.props.busy === true);

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const menuHeight = menuRef.current?.offsetHeight ?? 200;
    const left = Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
    const fitsBelow = rect.bottom + MENU_GAP + menuHeight <= window.innerHeight - 8;
    setPos(fitsBelow ? { top: rect.bottom + MENU_GAP, left } : { bottom: window.innerHeight - rect.top + MENU_GAP, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    function onMove(e: Event) {
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    // Move focus into the menu so keyboard users land on the first action.
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);

  if (items.length === 0) return null;

  if (inline) {
    return <div className={`flex flex-wrap items-center justify-end gap-1.5 ${className}`}>{items}</div>;
  }

  return (
    <div className={`flex justify-end ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setPos(null);
          setOpen((o) => !o);
        }}
        className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
          open ? "border-slate-400 bg-slate-100 text-slate-900" : "border-slate-300 text-slate-700 hover:bg-slate-100"
        } ${busy ? "animate-pulse" : ""}`}
      >
        {busy ? "Working..." : label}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={2} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{
              position: "fixed",
              width: MENU_WIDTH,
              left: pos?.left ?? -9999,
              top: pos?.top,
              bottom: pos?.bottom,
              // Measured on the first (hidden) frame, then placed.
              visibility: pos ? "visible" : "hidden",
            }}
            className="z-50 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
          >
            <MenuContext.Provider value={{ close }}>{items}</MenuContext.Provider>
          </div>,
          document.body
        )}
    </div>
  );
}

/**
 * The Activate/Deactivate pair every status-bearing admin entity has - one
 * call site instead of the same ternary on every page.
 */
export function StatusToggleAction({
  active,
  busy,
  onClick,
}: {
  active: boolean;
  busy?: boolean;
  onClick: () => void;
}) {
  return active ? (
    <RowAction kind="deactivate" busy={busy} onClick={onClick} />
  ) : (
    <RowAction kind="activate" busy={busy} onClick={onClick} />
  );
}
