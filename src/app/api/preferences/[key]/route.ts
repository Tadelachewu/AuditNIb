import { NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { withApiHandler } from "@/lib/api/handler";
import { isPreferenceKey, PREFERENCE_KEYS, setPreference } from "@/lib/userPreferences";

// The signed-in user's own preferences only (src/lib/userPreferences.ts) -
// there's no user id in the request, so nobody can change another user's.

async function handlePATCH(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { key } = await params;
  if (!isPreferenceKey(key)) return NextResponse.json({ error: "Unknown preference" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { value?: unknown } | null;
  if (!PREFERENCE_KEYS[key](body?.value)) return NextResponse.json({ error: "Invalid preference value" }, { status: 400 });
  const saved = await setPreference(auth.session.userId!, key, body!.value as Record<string, boolean>);
  return NextResponse.json({ ok: true, saved });
}

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const PATCH = withApiHandler(handlePATCH);
