import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { assertFindingInScope } from "@/lib/findings-scope";
import { notifyUsers } from "@/lib/notifications";

const commentSchema = z.object({
  text: z.string().trim().min(1, "Comment cannot be empty"),
  parentCommentId: z.string().optional().nullable(),
});

// proposal.txt §6: "District Directors shall have view and comment access"
// - comment is the one mutating action that role gets (see db.ts's
// districtDirectorPermissions). One level of threading: a reply's
// parentCommentId must point at a top-level comment, not another reply.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("findings.view");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const db = readDb();
  const existing = db.findings.find((f) => f.id === id);
  if (!existing) return NextResponse.json({ error: "Finding not found" }, { status: 404 });

  const scopeError = assertFindingInScope(auth.session, existing);
  if (scopeError) return NextResponse.json({ error: scopeError }, { status: 403 });

  return NextResponse.json({ comments: db.comments.filter((c) => c.findingId === id) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("findings.comment");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const parsed = commentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { text, parentCommentId } = parsed.data;

  const db = readDb();
  const existing = db.findings.find((f) => f.id === id);
  if (!existing) return NextResponse.json({ error: "Finding not found" }, { status: 404 });

  const scopeError = assertFindingInScope(auth.session, existing);
  if (scopeError) return NextResponse.json({ error: scopeError }, { status: 403 });

  let parent = null;
  if (parentCommentId) {
    parent = db.comments.find((c) => c.id === parentCommentId && c.findingId === id) ?? null;
    if (!parent) return NextResponse.json({ error: "Parent comment not found" }, { status: 404 });
    if (parent.parentCommentId) {
      return NextResponse.json({ error: "Replies can only be one level deep" }, { status: 400 });
    }
  }

  const created = updateDb((current) => {
    const f = current.findings.find((x) => x.id === id)!;
    const comment = {
      id: uuid(),
      findingId: f.id,
      parentCommentId: parentCommentId ?? null,
      authorId: auth.session.userId!,
      authorName: auth.session.name!,
      text,
      createdAt: new Date().toISOString(),
    };
    current.comments.push(comment);

    const recipients = new Set<string>();
    if (parent && parent.authorId !== auth.session.userId) recipients.add(parent.authorId);
    if (f.createdBy !== auth.session.userId) recipients.add(f.createdBy);
    if (recipients.size > 0) {
      notifyUsers(current, [...recipients], {
        type: "COMMENT",
        title: `New comment on ${f.reference}`,
        message: `${auth.session.name}: ${text.slice(0, 140)}`,
        entityType: "Finding",
        entityId: f.id,
      });
    }

    return comment;
  });

  return NextResponse.json({ comment: created }, { status: 201 });
}
