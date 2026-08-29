import { type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";

// Action buttons (Sign In, Create User, Sign Out, New Finding, and
// similar) show the brand gold sampled from the NIB logo's lower half
// (globals.css's --brand-gold) as their resting color, not just on hover -
// only sidebar/page-navigation links (src/components/layout/Sidebar.tsx,
// the admin Quick Links list) stay gold-on-hover-only, since those are
// navigation, not actions. `--brand-gold-dark` is only for the
// hover/press feedback on top of that resting gold. `danger` keeps its
// own red, unchanged - a destructive action losing its red cue would
// undermine the warning it's there for.
const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-brand-gold text-slate-900 hover:bg-brand-gold-dark disabled:bg-amber-100 disabled:text-slate-400",
  secondary: "bg-brand-gold text-slate-900 border border-brand-gold-dark hover:bg-brand-gold-dark disabled:bg-amber-100 disabled:text-slate-400 disabled:border-amber-200",
  danger: "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300",
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
