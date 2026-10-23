import type { ReactNode } from "react";

/**
 * A Communications form label (To, Cc, Subject, Message, the reply box):
 * semi-bold, like the finding page's labels - values stay normal weight.
 * Only here, so other forms' shared Label is unchanged.
 */
export function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs font-semibold text-slate-600">
      {children}
    </label>
  );
}
