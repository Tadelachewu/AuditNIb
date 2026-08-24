import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { assertFindingInScope } from "@/lib/findings-scope";
import { appendAuditLog } from "@/lib/audit";

const EDITABLE_STATUSES = ["DRAFT", "RETURNED"];

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("findings.view");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const db = readDb();
  const finding = db.findings.find((f) => f.id === id);
  if (!finding) return NextResponse.json({ error: "Finding not found" }, { status: 404 });

  const scopeError = assertFindingInScope(auth.session, finding);
  if (scopeError) return NextResponse.json({ error: scopeError }, { status: 403 });

  const transitions = db.findingTransitions
    .filter((t) => t.findingId === id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const rectifications = db.rectifications
    .filter((r) => r.findingId === id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return NextResponse.json({ finding, transitions, rectifications });
}

const updateSchema = z.object({
  findingDate: z.string().min(1).optional(),
  operationArea: z.string().min(1).optional(),
  irregularityType: z.string().min(1).optional(),
  categoryId: z.string().min(1).optional(),
  amount: z.number().nonnegative().optional(),
  currency: z.string().min(1).optional(),
  caseCount: z.number().int().positive().optional(),
  riskLevel: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  recommendation: z.string().optional(),
  evidenceNote: z.string().optional(),
});

// Only DRAFT/RETURNED are editable (plan doc §3.3). Editing a RETURNED
// finding does not by itself resubmit it - that's the separate
// POST .../submit action, same as an initial DRAFT.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("findings.edit");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const db = readDb();
  const existing = db.findings.find((f) => f.id === id);
  if (!existing) return NextResponse.json({ error: "Finding not found" }, { status: 404 });

  const scopeError = assertFindingInScope(auth.session, existing);
  if (scopeError) return NextResponse.json({ error: scopeError }, { status: 403 });

  if (!EDITABLE_STATUSES.includes(existing.status)) {
    return NextResponse.json({ error: "Only draft or returned findings can be edited" }, { status: 409 });
  }

  const before = { ...existing };
  const updated = updateDb((current) => {
    const f = current.findings.find((x) => x.id === id)!;
    Object.assign(f, parsed.data);
    f.updatedAt = new Date().toISOString();
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "UPDATE",
      entityType: "Finding",
      entityId: f.id,
      oldValue: before,
      newValue: f,
    });
    return f;
  });

  return NextResponse.json({ finding: updated });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("findings.delete");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const db = readDb();
  const existing = db.findings.find((f) => f.id === id);
  if (!existing) return NextResponse.json({ error: "Finding not found" }, { status: 404 });

  const scopeError = assertFindingInScope(auth.session, existing);
  if (scopeError) return NextResponse.json({ error: scopeError }, { status: 403 });

  if (existing.status !== "DRAFT") {
    return NextResponse.json({ error: "Only draft findings can be deleted" }, { status: 409 });
  }

  updateDb((current) => {
    current.findings = current.findings.filter((f) => f.id !== id);
    current.findingTransitions = current.findingTransitions.filter((t) => t.findingId !== id);
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "DELETE",
      entityType: "Finding",
      entityId: id,
      oldValue: existing,
    });
  });

  return NextResponse.json({ ok: true });
}
