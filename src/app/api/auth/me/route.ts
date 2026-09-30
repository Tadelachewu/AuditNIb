import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { withApiHandler } from "@/lib/api/handler";

async function handleGET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }
  return NextResponse.json({ user });
}

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const GET = withApiHandler(handleGET);
