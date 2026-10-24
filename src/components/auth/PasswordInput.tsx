"use client";

import { useState, type ComponentProps } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/Field";

/**
 * A password field with a show / hide (eye) button, the same as the login
 * page's. Used by Change Password (profile) and Reset Password. Each field
 * has its own toggle.
 */
export function PasswordInput({ id, className = "", ...props }: Omit<ComponentProps<"input">, "type"> & { id: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input {...props} id={id} type={show ? "text" : "password"} className={`pr-10 ${className}`} />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? "Hide password" : "Show password"}
        aria-pressed={show}
        aria-controls={id}
        title={show ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-500 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-sky-600"
      >
        {show ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>
  );
}
