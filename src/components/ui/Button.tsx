import { type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger" | "success" | "ghost";

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
  primary: "bg-brand-gold text-slate-900 hover:bg-brand-gold-dark disabled:bg-amber-100 disabled:text-slate-400",
  secondary:
    "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 hover:border-slate-400 disabled:bg-slate-50 disabled:text-slate-300 disabled:border-slate-200",
  danger: "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300",
  // For an affirmative/approve action that shouldn't read as destructive
  // (e.g. accepting a rectification as closed) - deliberately not `danger`
  // (that red cue means "this is risky"), and distinct from `primary`'s
  // gold since gold is the app's generic "do the one thing here" color,
  // not specifically "approve." Matches Badge tone="green"'s emerald hue.
  success: "bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-300",
  ghost: "text-slate-600 hover:bg-brand-gold hover:text-slate-900 disabled:text-slate-300",
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
