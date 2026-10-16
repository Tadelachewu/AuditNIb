import { NextResponse } from "next/server";
import type { Result } from "@/lib/communications/service";

/** A service Result as an API response: the value (or `wrap(value)`) on success, `{ error }` with its status otherwise. */
export function respond<T>(result: Result<T>, wrap?: (value: T) => unknown, status = 200): NextResponse {
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(wrap ? wrap(result.value) : result.value, { status });
}
