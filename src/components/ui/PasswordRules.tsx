import { Check, X } from "lucide-react";
import { passwordRuleChecks } from "@/lib/passwordValidation";

/**
 * The password policy as a live checklist under a password field - the
 * same rules the server enforces (src/lib/passwordValidation.ts). Shown
 * once something is typed. The server additionally rejects passwords found
 * in known data breaches, which can't be checked here.
 */
export function PasswordRules({ password, id }: { password: string; id?: string }) {
  if (!password) return null;
  return (
    <ul id={id} className="mt-1.5 grid gap-0.5 text-xs" aria-label="Password requirements">
      {passwordRuleChecks(password).map((rule) => (
        <li key={rule.label} className={`flex items-center gap-1.5 ${rule.ok ? "text-emerald-700" : "text-slate-500"}`}>
          {rule.ok ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <X className="h-3.5 w-3.5 text-red-500" aria-hidden="true" />}
          <span>
            {rule.label}
            <span className="sr-only">{rule.ok ? " (met)" : " (not met)"}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
