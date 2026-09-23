import { type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes, type ReactNode } from "react";

const fieldClass =
  "w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-1 focus:ring-blue-700";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${fieldClass} ${props.className ?? ""}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${fieldClass} bg-white ${props.className ?? ""}`} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${fieldClass} ${props.className ?? ""}`} />;
}

// A plain <input type="file"> renders the browser's own default "Choose
// File" button - a flat gray control that, sitting next to this app's bold
// gold action buttons, reads as disabled/non-actionable rather than a real
// clickable control. Tailwind's `file:` variant styles just that native
// button pseudo-element (the filename text stays plain), matching
// Button's own `primary` gold treatment exactly so it reads as one of the
// app's real actions.
export function FileInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="file"
      {...props}
      className={`text-sm text-slate-600 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-brand-gold file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-on-gold hover:file:bg-brand-gold-dark disabled:file:cursor-not-allowed disabled:file:bg-amber-100 disabled:file:text-slate-400 ${props.className ?? ""}`}
    />
  );
}

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-slate-600">
      {children}
    </label>
  );
}
