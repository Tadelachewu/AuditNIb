"use client";

import { useId, useState, type ComponentProps } from "react";
import { Input, Textarea } from "@/components/ui/Field";

/**
 * A text field checked by one of the shared input rules (src/lib/inputRules.ts,
 * the same rules the API enforces). The rule's message appears under the
 * field once the user has left it (or typed into it after leaving), marks it
 * invalid for screen readers, and otherwise shows `hint` if given. The form
 * disables its submit button with the same rule, so nothing invalid is sent.
 */
export function RuleInput({
  check,
  value,
  hint,
  multiline = false,
  filter,
  showProblemNow = false,
  ...props
}: Omit<ComponentProps<"input">, "value"> & {
  value: string;
  check: (value: string) => string | null;
  hint?: string;
  multiline?: boolean;
  /** Removes characters the field can't contain while typing/pasting (INPUT_FILTERS in src/lib/inputRules.ts). */
  filter?: (value: string) => string;
  /** Show the problem even before the user has touched the field (e.g. a pre-filled date that doesn't fit the selected period). */
  showProblemNow?: boolean;
}) {
  const [touched, setTouched] = useState(false);
  const autoId = useId();
  const messageId = `${props.id ?? autoId}-message`;
  const problem = touched || showProblemNow ? check(value) : null;
  const shared = {
    value,
    "aria-invalid": problem ? true : undefined,
    "aria-describedby": problem || hint ? messageId : undefined,
    className: `${props.className ?? ""} ${problem ? "border-red-400" : ""}`.trim(),
  } as const;
  return (
    <>
      {multiline ? (
        <Textarea
          id={props.id}
          name={props.name}
          rows={3}
          maxLength={props.maxLength}
          placeholder={props.placeholder}
          required={props.required}
          disabled={props.disabled}
          onChange={props.onChange as unknown as ComponentProps<"textarea">["onChange"]}
          onBlur={() => setTouched(true)}
          {...shared}
        />
      ) : (
        <Input
          {...props}
          {...shared}
          onChange={(e) => {
            if (filter) {
              const cleaned = filter(e.target.value);
              if (cleaned !== e.target.value) e.target.value = cleaned;
            }
            props.onChange?.(e);
          }}
          onBlur={(e) => {
            setTouched(true);
            props.onBlur?.(e);
          }}
        />
      )}
      {(problem || hint) && (
        <p id={messageId} className={`mt-1 text-xs ${problem ? "text-red-600" : "text-slate-500"}`}>
          {problem ? `${problem}.` : hint}
        </p>
      )}
    </>
  );
}
