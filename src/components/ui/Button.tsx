import { type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger" | "success" | "info" | "neutral" | "warning" | "ghost";

// Action buttons (Sign In, Create User, Sign Out, New Finding, and
// similar) show the brand gold sampled from the NIB logo's lower half
// (globals.css's --brand-gold) as their resting color, not just on hover -
// only sidebar/page-navigation links (src/components/layout/Sidebar.tsx,
// the admin Quick Links list) stay gold-on-hover-only, since those are
// navigation, not actions. `--brand-gold-dark` is only for the
// hover/press feedback on top of that resting gold. `danger` keeps its
// own red, unchanged - a destructive action losing its red cue would
// undermine the warning it's there for.
//
// `secondary` used to also be solid gold (bg-brand-gold, same as
// `primary`, differing only by a border) - visually indistinguishable
// from a page's one genuinely primary action (Create/Save/Submit) on
// every page that also has secondary actions (Cancel, Edit, Show My
// Queue, toggle buttons) sitting right next to it, which flattens the
// hierarchy the two variants exist to express. Given a neutral outline
// style instead - still a clear, deliberate action, just visually
// subordinate to gold - so gold reads as "the one thing to do here"
// again rather than "every button on this page."
const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-brand-gold text-on-gold hover:bg-brand-gold-dark disabled:bg-amber-100 disabled:text-slate-400",
  secondary:
    "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 hover:border-slate-400 disabled:bg-slate-50 disabled:text-slate-300 disabled:border-slate-200",
  // Fixed literal hex, not the theme-remapped red-600/700/300 tokens -
  // those flip to pale tints in dark mode (see globals.css's dark-mode
  // block, meant for the pale-bg-plus-dark-text Badge idiom), which would
  // leave this "solid red + white text" idiom with washed-out white-on-
  // pale-pink. A destructive action losing its red cue this way would
  // undermine the warning it's there for just as much as never theming it
  // at all would - same reasoning as this variant's own comment above.
  danger: "bg-[#dc2626] text-on-dark hover:bg-[#b91c1c] disabled:bg-[#fca5a5]",
  // For an affirmative/approve action that shouldn't read as destructive
  // (e.g. accepting a rectification as closed) - deliberately not `danger`
  // (that red cue means "this is risky"), and distinct from `primary`'s
  // gold since gold is the app's generic "do the one thing here" color,
  // not specifically "approve." Matches Badge tone="green"'s emerald hue.
  // Fixed literal hex for the same reason `danger` just above is.
  success: "bg-[#059669] text-on-dark hover:bg-[#047857] disabled:bg-[#6ee7b7]",
  // "Send this into/through the workflow" - Submit, Verify, Transfer to
  // Next Period. Distinct from `primary`'s gold (gold means "the one
  // generic action on this page," not specifically "this moves the
  // record forward") and from `success` (this isn't a final approval/
  // completion, just a step). Matches Badge tone="blue"'s hue. Fixed
  // literal hex for the same dark-mode-washout reason `danger`/`success`
  // above use one.
  info: "bg-[#2563eb] text-on-dark hover:bg-[#1d4ed8] disabled:bg-[#93c5fd]",
  // A bold action that's deliberately NOT a workflow step - Save Draft,
  // Edit-while-DRAFT. `secondary`'s pale outline reads as subordinate/
  // inactive sitting next to a bold `info` Submit (Edit and Submit render
  // side by side on a DRAFT/RETURNED finding); this stays solid and
  // clearly clickable while staying visually distinct from every
  // workflow-transition color above. Fixed literal hex for the same
  // dark-mode-washout reason as the others.
  neutral: "bg-[#475569] text-on-dark hover:bg-[#334155] disabled:bg-[#cbd5e1]",
  // "Return for Correction" on an already-approved, in-progress
  // rectification (Verify Rectification card) - distinct from `danger`'s
  // plain "Return"/"Reject" at the pre-approval review stages: this is a
  // milder, mid-workflow correction request, not a hard stop/rejection of
  // the finding itself. text-on-gold (dark text), not text-on-dark - amber
  // is too light for white text to stay readable (~2:1 contrast; on-gold
  // clears WCAG AA), same reasoning as text on brand-gold.
  warning: "bg-[#f59e0b] text-on-gold hover:bg-[#d97706] disabled:bg-[#fde68a]",
  ghost: "text-slate-600 hover:bg-brand-gold hover:text-on-gold disabled:text-slate-300",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    />
  );
}
