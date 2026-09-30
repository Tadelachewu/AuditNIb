import { beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import type { Database } from "@/types";

// In-memory database standing in for Postgres; updateDb applies the
// mutator to it, exactly like the real transaction wrapper.
let db: Database;
vi.mock("@/lib/db", () => ({
  readDb: vi.fn(async () => structuredClone(db)),
  updateDb: vi.fn(async (fn: (d: Database) => unknown) => fn(db)),
}));
vi.mock("@/lib/fileStorage", () => ({
  writeStoredFile: vi.fn(),
  deleteStoredFile: vi.fn(() => true),
  newStoredName: vi.fn(() => "stored-file.xlsx.enc"),
  readStoredFile: vi.fn(),
}));

import { runImport } from "@/lib/importRun";
import { importReverseImpact, reverseImportBatch } from "@/lib/importReverse";
import { nextFindingReference } from "@/lib/findings";
import { buildImportTemplate } from "@/lib/import";
import { ApplicationError } from "@/lib/errors";

function fixture(): Database {
  return {
    users: [{ id: "u1", username: "ho", name: "HO", role: "HO", status: "ACTIVE" }],
    roles: [],
    districts: [{ id: "d1", code: "D01", name: "Addis", status: "ACTIVE" }],
    branches: [{ id: "b1", code: "B001", name: "Bole", districtId: "d1", status: "ACTIVE" }],
    sources: [{ id: "s1", code: "IA", name: "Internal Audit", active: true }],
    departments: [{ id: "dep1", code: "OPS", name: "Operations", active: true, orgScope: "BANK" }],
    categories: [{ id: "c1", code: "CASH", name: "Cash", active: true }],
    reportingPeriods: [
      { id: "p9", code: "2026-09", year: 2026, month: 9, status: "OPEN", startsAt: "2026-08-31T21:00:00.000Z", endsAt: "2026-09-30T20:59:00.000Z" },
    ],
    settings: {
      currencies: ["ETB"],
      riskLevels: ["Low", "High"],
      priorityLevels: ["Low", "High"],
      operationAreas: ["Teller Counter"],
      irregularityTypes: ["Cash Shortage"],
      requiredFindingFields: {},
      // The admin's duplicate rule (Settings → Similar Findings).
      similarFindingFields: ["branchId", "periodId", "categoryId", "findingDate", "amount", "caseCount"],
    },
    findings: [],
    findingTransitions: [],
    rectifications: [],
    findingTransfers: [],
    findingClosures: [],
    findingCases: [],
    importBatches: [],
    evidence: [],
    comments: [],
    notifications: [],
    auditLogs: [],
    scoringRules: [],
    scoringAdjustments: [],
  } as unknown as Database;
}

async function workbook(rows: Record<string, string | number>[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await buildImportTemplate(db)) as unknown as ArrayBuffer);
  const sheet = wb.getWorksheet("Findings")!;
  const headers = (sheet.getRow(1).values as string[]).slice(1).map((h) => h.replace(/ \(optional\)$/, ""));
  for (const r of rows) sheet.addRow(headers.map((h) => r[h] ?? ""));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const row = (over: Record<string, string | number> = {}) => ({
  "District Code": "D01",
  "Branch Code": "B001",
  "Reporting Period Code": "2026-09",
  "Source Code": "IA",
  "Department Code": "OPS",
  "Classified Category Code": "CASH",
  Title: "Cash shortage at teller",
  "Finding Date (YYYY-MM-DD)": "2026-09-10",
  "Operation Area": "Teller Counter",
  "Type of Irregularity": "Cash Shortage",
  Amount: 5000,
  Currency: "ETB",
  "Number of Cases": 2,
  "Risk Level": "Low",
  Priority: "Low",
  Description: "d",
  "Status (SENT_TO_BRANCH_MANAGER / TRANSFERRED / CLOSED)": "SENT_TO_BRANCH_MANAGER",
  ...over,
});
const actor = { userId: "u1", userName: "HO", orgScope: "BANK", districtId: null, branchId: null };

beforeEach(() => {
  db = fixture();
});

describe("import: duplicates are the final decision", () => {
  it("errors come first - a file with errors never reaches the duplicate check", async () => {
    const file = await workbook([row(), row({ "Branch Code": "NOPE" })]);
    await expect(runImport(file, "f.xlsx", actor, { importDuplicates: false })).rejects.toMatchObject({ code: "IMPORT_FILE_INVALID" });
    expect(db.findings).toHaveLength(0);
  });

  it("reports duplicates with evidence and imports nothing until the importer decides", async () => {
    const first = await runImport(await workbook([row()]), "first.xlsx", actor, { importDuplicates: false });
    expect(first.importedCount).toBe(1);
    const existingRef = db.findings[0].reference;

    const file = await workbook([row({ Title: "Different wording, same facts" }), row({ Amount: 9999, Title: "New one" })]);
    const err = (await runImport(file, "second.xlsx", actor, { importDuplicates: false }).catch((e) => e)) as ApplicationError;
    expect(err).toBeInstanceOf(ApplicationError);
    expect(err.code).toBe("IMPORT_DUPLICATES_FOUND");
    const details = err.details as { matchFields: string[]; duplicates: { rowNumber: number; matchesReference: string; withinFile: boolean; rowTitle: string; existing: { title: string; amount: number } }[] };
    expect(details.matchFields).toEqual(["Branch", "Reporting period", "Classified case", "Finding date", "Amount", "Number of cases"]);
    expect(details.duplicates).toEqual([
      expect.objectContaining({ rowNumber: 2, matchesReference: existingRef, withinFile: false, rowTitle: "Different wording, same facts", existing: expect.objectContaining({ title: "Cash shortage at teller", amount: 5000 }) }),
    ]);
    expect(db.findings).toHaveLength(1); // nothing imported yet

    // "Import anyway": every row imported, the duplicate keeps a pointer to what it matched.
    const batch = await runImport(file, "second.xlsx", actor, { importDuplicates: true });
    expect(batch).toMatchObject({ importedCount: 2, duplicateCount: 0 });
    expect(batch.rows.find((r) => r.rowNumber === 2)).toMatchObject({ outcome: "imported", duplicateOfReference: existingRef });
    expect(db.findings).toHaveLength(3);
  });

  it("uses only the admin-configured fields: a different title still matches, a different amount doesn't", async () => {
    await runImport(await workbook([row()]), "a.xlsx", actor, { importDuplicates: false });
    await expect(runImport(await workbook([row({ Title: "Other words" })]), "b.xlsx", actor, { importDuplicates: false })).rejects.toMatchObject({ code: "IMPORT_DUPLICATES_FOUND" });
    const ok = await runImport(await workbook([row({ Amount: 1234 })]), "c.xlsx", actor, { importDuplicates: false });
    expect(ok.importedCount).toBe(1);
  });

  it("no fields configured = duplicate check off", async () => {
    (db.settings as { similarFindingFields: string[] }).similarFindingFields = [];
    const batch = await runImport(await workbook([row(), row()]), "f.xlsx", actor, { importDuplicates: false });
    expect(batch.importedCount).toBe(2);
  });

  it("flags duplicates within the same file", async () => {
    const err = (await runImport(await workbook([row(), row()]), "f.xlsx", actor, { importDuplicates: false }).catch((e) => e)) as ApplicationError;
    expect(err.code).toBe("IMPORT_DUPLICATES_FOUND");
    expect((err.details as { duplicates: { withinFile: boolean; matchesRowNumber: number }[] }).duplicates[0]).toMatchObject({ withinFile: true, matchesRowNumber: 2 });
  });
});

describe("import: reverse regardless of later work, then re-import or delete", () => {
  it("reverses even after comments / evidence / workflow, removing everything attached", async () => {
    const batch = await runImport(await workbook([row(), row({ Amount: 7000 })]), "f.xlsx", actor, { importDuplicates: false });
    const f = db.findings[0];
    db.comments.push({ id: "cm1", findingId: f.id } as never);
    db.evidence.push({ id: "ev1", findingId: f.id, storagePath: "evidence-file.enc" } as never);
    db.findingTransitions.push({ id: "t-live", findingId: f.id, action: "CLOSE" } as never);

    const impact = importReverseImpact(db, db.importBatches[0]);
    expect(impact.findings).toBe(2);
    expect(impact.evidenceFiles).toBe(1);
    expect(impact.withActivity[0]).toMatch(new RegExp(`^${f.reference}: .*workflow action.*comment.*evidence`));

    const result = reverseImportBatch(db, db.importBatches[0], { userId: "u1", userName: "HO" }, "wrong file");
    expect(result.removedReferences).toHaveLength(2);
    expect(result.evidenceFilesToDelete).toEqual(["evidence-file.enc"]);
    expect(db.findings).toHaveLength(0);
    expect(db.comments).toHaveLength(0);
    expect(db.evidence).toHaveLength(0);
    expect(db.findingTransitions.filter((t) => t.findingId === f.id)).toHaveLength(0);
    expect(db.importBatches[0].reversedAt).toBeTruthy();
    expect(db.auditLogs.some((l) => l.action === "IMPORT_REVERSE" && l.reason === "wrong file")).toBe(true);
    expect(batch.id).toBe(db.importBatches[0].id);
  });

  it("reverse-and-delete removes the record but keeps its reference numbers reserved", async () => {
    await runImport(await workbook([row()]), "f.xlsx", actor, { importDuplicates: false });
    const ref = db.findings[0].reference;
    const result = reverseImportBatch(db, db.importBatches[0], { userId: "u1", userName: "HO" }, "remove entirely", { deleteRecord: true });
    expect(db.importBatches).toHaveLength(0);
    expect(result.importFileToDelete).toBe("stored-file.xlsx.enc");
    const next = nextFindingReference(db, db.branches[0], db.reportingPeriods[0]);
    expect(next).not.toBe(ref);
    expect(Number(next.slice(-5))).toBe(Number(ref.slice(-5)) + 1);
  });

  it("the same file can be imported again after reversal (no false duplicates)", async () => {
    const file = await workbook([row()]);
    await runImport(file, "f.xlsx", actor, { importDuplicates: false });
    reverseImportBatch(db, db.importBatches[0], { userId: "u1", userName: "HO" }, "fix and redo");
    const again = await runImport(file, "f.xlsx", actor, { importDuplicates: false });
    expect(again.importedCount).toBe(1);
  });
});

describe("reopen a closed finding", () => {
  it("resets to a fresh Sent to Branch Manager, removes closure/rectification credit, keeps history", async () => {
    const { reopenFinding, canReopen } = await import("@/lib/findingReopen");
    await runImport(await workbook([row({ "Status (SENT_TO_BRANCH_MANAGER / TRANSFERRED / CLOSED)": "CLOSED" })]), "f.xlsx", actor, { importDuplicates: false });
    const f = db.findings[0];
    expect(f.status).toBe("CLOSED");
    expect(f.closedCases).toBe(2);
    expect(db.findingClosures.filter((c) => c.findingId === f.id)).toHaveLength(1);
    const transitionsBefore = db.findingTransitions.filter((t) => t.findingId === f.id).length;
    expect(canReopen(f)).toBe(true);

    reopenFinding(db, f, { userId: "u1", userName: "HO" }, "closed by mistake");

    expect(f).toMatchObject({ status: "SENT_TO_BRANCH_MANAGER", rectifiedCases: 0, rectifiedAmount: 0, districtVerifiedCases: 0, closedCases: 0, closedAmount: 0 });
    expect(db.findingClosures.filter((c) => c.findingId === f.id)).toHaveLength(0);
    expect(db.rectifications.filter((r) => r.findingId === f.id)).toHaveLength(0);
    const transitions = db.findingTransitions.filter((t) => t.findingId === f.id);
    expect(transitions.length).toBe(transitionsBefore + 1); // history kept, one REOPEN added
    expect(transitions.some((t) => t.action === "REOPEN" && t.fromStatus === "CLOSED" && t.reason === "closed by mistake")).toBe(true);
    const audit = db.auditLogs.find((l) => l.action === "REOPEN_RESET");
    expect((audit?.oldValue as { closedCases: number; closures: unknown[] }).closedCases).toBe(2);
    expect((audit?.oldValue as { closures: unknown[] }).closures).toHaveLength(1);
    expect(canReopen(f)).toBe(false);
  });
});
