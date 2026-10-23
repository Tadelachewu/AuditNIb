import type { ReactNode } from "react";

/**
 * Semi-bold field label for the admin forms - the shared Label
 * (src/components/ui/Field.tsx) stays as is for the rest of the app.
 */
export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs font-semibold text-slate-600">
      {children}
    </label>
  );
}
