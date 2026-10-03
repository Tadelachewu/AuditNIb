import { beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import type { Database } from "@/types";

// Reference numbers for imports, checked against docs/reference-numbers-guide.md
// (§2 lowest free number, §4 import, §5 manual delete, §6 reverse / re-import -
// a removed finding's number is free again, whether deleted by hand or by reversing an import).
// In-memory database standing in for Postgres; updateDb applies the
// mutator to it, exactly like the real transaction wrapper.
let db: Database;
vi.mock("@/lib/db", () => ({
  readDb: vi.fn(async () => structuredClone(db)),
  updateDb: vi.fn(async (fn: (d: Database) => unknown) => fn(db)),
}));
vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ captureServerException: vi.fn(async () => {}) }));
vi.mock("@/lib/fileStorage", () => ({
  writeStoredFile: vi.fn(),
  deleteStoredFile: vi.fn(() => true),
  newStoredName: vi.fn(() => "stored-file.xlsx.enc"),
  readStoredFile: vi.fn(),
}));

import { runImport } from "@/lib/importRun";
import { reverseImportBatch } from "@/lib/importReverse";
import { nextFindingReference } from "@/lib/findings";
import { buildImportTemplate } from "@/lib/import";

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
      { id: "p10", code: "2026-10", year: 2026, month: 10, status: "OPEN", startsAt: "2026-09-30T21:00:00.000Z", endsAt: "2026-10-31T20:59:00.000Z" },
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

import { getCurrentUser } from "@/lib/session";
import { DELETE as deleteImportRecord } from "@/app/api/findings/import/[batchId]/route";
import { POST as registerFinding } from "@/app/api/findings/route";
import { DELETE as deleteFinding } from "@/app/api/findings/[id]/route";

const refs = () => db.findings.map((f) => f.reference).sort();
const rowN = (n: number, over: Record<string, string | number> = {}) => row({ Amount: 1000 + n, ...over }); // distinct rows (no duplicates)
const importRows = async (rows: Record<string, string | number>[], name = "f.xlsx") =>
  runImport(await workbook(rows), name, actor, { importDuplicates: false });
const asAdmin = () =>
  vi.mocked(getCurrentUser).mockResolvedValue({
    isLoggedIn: true, userId: "u1", name: "HO", orgScope: "BANK",
    permissions: ["findings.create", "findings.delete", "findings.reverse-import", "findings.import"],
  } as never);
const P = "B001-2026-09-";

describe("import reference numbers (docs/reference-numbers-guide.md)", () => {
  it("§4 rows are numbered top to bottom with consecutive numbers", async () => {
    await importRows([rowN(1), rowN(2), rowN(3)]);
    expect(refs()).toEqual([`${P}00001`, `${P}00002`, `${P}00003`]);
    expect(db.importBatches[0].rows.map((r) => r.reference)).toEqual([`${P}00001`, `${P}00002`, `${P}00003`]);
  });

  it("§4 an import fills a gap left by a deleted finding first, then continues", async () => {
    await importRows([rowN(1), rowN(2), rowN(3)], "a.xlsx");
    db.findings = db.findings.filter((f) => f.reference !== `${P}00002`); // as if deleted by hand
    await importRows([rowN(4), rowN(5), rowN(6)], "b.xlsx");
    expect(db.importBatches[1].rows.map((r) => r.reference)).toEqual([`${P}00002`, `${P}00004`, `${P}00005`]);
  });

  it("§4 imported and hand-registered findings share one sequence", async () => {
    asAdmin();
    await importRows([rowN(1)]);
    const body = { periodId: "p9", districtId: "d1", branchId: "b1", sourceId: "s1", departmentId: "dep1", categoryId: "c1", title: "Manual finding", findingDate: "2026-09-12", operationArea: "Teller Counter", irregularityType: "Cash Shortage", amount: 99, currency: "ETB", caseCount: 1, riskLevel: "Low", priority: "Low", description: "d" };
    const res = await registerFinding(new Request("http://x/api/findings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({}) } as never);
    expect(res.status).toBe(201);
    await importRows([rowN(2)], "b.xlsx");
    expect(refs()).toEqual([`${P}00001`, `${P}00002`, `${P}00003`]);
    expect(db.findings.find((f) => f.reference === `${P}00002`)!.importBatchId).toBeUndefined(); // the manual one
  });

  it("§4 a TRANSFERRED row is numbered in its Reporting Period, not Transferred To", async () => {
    await importRows([rowN(1, {
      "Status (SENT_TO_BRANCH_MANAGER / TRANSFERRED / CLOSED)": "TRANSFERRED",
      "Transferred To Period Code (required only if Status is TRANSFERRED)": "2026-10",
    })]);
    expect(db.findings[0].reference).toBe(`${P}00001`);
    expect(db.findings[0].periodId).toBe("p10");
  });

  it("§4 a file with errors imports nothing and uses no numbers", async () => {
    await expect(importRows([rowN(1), rowN(2, { "Branch Code": "NOPE" })])).rejects.toBeTruthy();
    await importRows([rowN(3)], "ok.xlsx");
    expect(refs()).toEqual([`${P}00001`]);
  });

  it("§5 a hand-deleted draft's number is reused by the next import", async () => {
    asAdmin();
    await importRows([rowN(1), rowN(2)]);
    const second = db.findings.find((f) => f.reference === `${P}00002`)!;
    Object.assign(second, { status: "DRAFT", createdBy: "u1" });
    db.reportingPeriods[0].status = "OPEN";
    const res = await deleteFinding(new Request("http://x", { method: "DELETE" }), { params: Promise.resolve({ id: second.id }) } as never);
    expect(res.status).toBe(200);
    await importRows([rowN(3)], "b.xlsx");
    expect(refs()).toEqual([`${P}00001`, `${P}00002`]);
  });

  it("§6 Reverse import: the numbers are free again (an empty branch + period starts at 00001)", async () => {
    await importRows([rowN(1), rowN(2)]);
    reverseImportBatch(db, db.importBatches[0], { userId: "u1", userName: "HO" }, "wrong file");
    expect(db.findings).toHaveLength(0);
    await importRows([rowN(3)], "b.xlsx");
    expect(refs()).toEqual([`${P}00001`]);
  });

  it("§6 Reverse and delete record: free again", async () => {
    await importRows([rowN(1), rowN(2)]);
    reverseImportBatch(db, db.importBatches[0], { userId: "u1", userName: "HO" }, "remove", { deleteRecord: true });
    expect(db.importBatches).toHaveLength(0);
    expect(nextFindingReference(db, db.branches[0], db.reportingPeriods[0])).toBe(`${P}00001`);
  });

  it("§6 Delete record of an already-reversed import: free again", async () => {
    asAdmin();
    await importRows([rowN(1), rowN(2)]);
    const batch = db.importBatches[0];
    reverseImportBatch(db, batch, { userId: "u1", userName: "HO" }, "wrong file");
    const res = await deleteImportRecord(new Request("http://x", { method: "DELETE" }), { params: Promise.resolve({ batchId: batch.id }) } as never);
    expect(res.status).toBe(200);
    expect(nextFindingReference(db, db.branches[0], db.reportingPeriods[0])).toBe(`${P}00001`);
  });

  it("§6 Re-import after reversing: the same numbers again, in file order", async () => {
    await importRows([rowN(1), rowN(2), rowN(3)]);
    reverseImportBatch(db, db.importBatches[0], { userId: "u1", userName: "HO" }, "fix and redo");
    await runImport(await workbook([rowN(1), rowN(2), rowN(3)]), "f.xlsx", actor, { importDuplicates: false, auditAction: "IMPORT_REIMPORT", reimportOf: db.importBatches[0].id });
    expect(refs()).toEqual([`${P}00001`, `${P}00002`, `${P}00003`]);
  });

  it("repeated import + reverse of the same file (the reported case) always starts again at 00001", async () => {
    for (let i = 0; i < 4; i++) {
      await importRows([rowN(1), rowN(2)], `try-${i}.xlsx`);
      reverseImportBatch(db, db.importBatches[db.importBatches.length - 1], { userId: "u1", userName: "HO" }, "retest", { deleteRecord: i % 2 === 0 });
    }
    await importRows([rowN(1), rowN(2)], "final.xlsx");
    expect(refs()).toEqual([`${P}00001`, `${P}00002`]);
  });
});
