import { z } from "zod";

/**
 * Plain-language defaults for Zod's built-in messages, app-wide. A schema's
 * own message (e.g. .min(1, "Name is required")) always wins; this only
 * replaces Zod's generic, technical ones ("Invalid input: expected
 * nonoptional, received undefined") that would otherwise reach users.
 * Loaded by the API handler (src/lib/api/handler.ts), so every route gets it.
 */
function fieldName(path: readonly PropertyKey[] | undefined): string {
  const last = path?.length ? String(path[path.length - 1]) : "";
  if (!last || /^\d+$/.test(last)) return "A value";
  const words = last.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function friendlyZodMessage(iss: { code?: string; input?: unknown; path?: readonly PropertyKey[]; minimum?: unknown; maximum?: unknown; origin?: string }): string | undefined {
  const field = fieldName(iss.path);
  switch (iss.code) {
    case "invalid_type":
      return iss.input === undefined || iss.input === null ? `${field} is required.` : `${field} has an invalid value.`;
    case "invalid_value":
    case "invalid_union":
      return `${field} has an invalid value.`;
    case "invalid_format":
      return `${field} is not in a valid format.`;
    case "too_small":
      if (iss.origin === "string") return Number(iss.minimum) <= 1 ? `${field} is required.` : `${field} must be at least ${iss.minimum} characters.`;
      if (iss.origin === "array") return `${field} needs at least ${iss.minimum} item(s).`;
      return `${field} must be at least ${iss.minimum}.`;
    case "too_big":
      if (iss.origin === "string") return `${field} must be at most ${iss.maximum} characters.`;
      if (iss.origin === "array") return `${field} can have at most ${iss.maximum} item(s).`;
      return `${field} must be at most ${iss.maximum}.`;
    case "unrecognized_keys":
      return "The request contains fields that aren't allowed.";
    default:
      return undefined; // keep Zod's default
  }
}

z.config({ customError: (iss) => friendlyZodMessage(iss as Parameters<typeof friendlyZodMessage>[0]) });
