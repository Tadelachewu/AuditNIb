import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { officeFileProblem, uploadNameProblem, zipEntries } from "@/lib/uploadChecks";
import { makeZip, officeZip } from "./helpers/zip";

// Server-side upload checks shared by evidence, Communications attachments
// and the findings import (src/lib/uploadChecks.ts).

const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

describe("file names", () => {
  it("the extension must match the file's real type (any letter case)", () => {
    expect(uploadNameProblem("report.pdf", PDF)).toBeNull();
    expect(uploadNameProblem("REPORT.PDF", PDF)).toBeNull();
    expect(uploadNameProblem("photo.jpeg", "image/jpeg")).toBeNull();
    expect(uploadNameProblem("photo.jpg", "image/jpeg")).toBeNull();
    expect(uploadNameProblem("plan.docx", DOCX)).toBeNull();
    expect(uploadNameProblem("findings.xlsx", XLSX)).toBeNull();
  });
  it("a real PDF named like a program, or with no / a double extension, is refused", () => {
    expect(uploadNameProblem("report.exe", PDF)).toMatch(/\.pdf/);
    expect(uploadNameProblem("report", PDF)).toMatch(/\.pdf/);
    expect(uploadNameProblem("report.pdf.exe", PDF)).toMatch(/\.pdf/);
    expect(uploadNameProblem("macro.docm", DOCX)).toMatch(/\.docx/);
    expect(uploadNameProblem("book.xls", XLSX)).toMatch(/\.xlsx/);
  });
  it("folders, control characters, empty or overlong names are refused", () => {
    expect(uploadNameProblem("../../etc/passwd.pdf", PDF)).toMatch(/characters/);
    expect(uploadNameProblem("C:\\temp\\a.pdf", PDF)).toMatch(/characters/);
    expect(uploadNameProblem("a\u0000.pdf", PDF)).toMatch(/characters/);
    expect(uploadNameProblem("   ", PDF)).toMatch(/no name/);
    expect(uploadNameProblem(`${"a".repeat(260)}.pdf`, PDF)).toMatch(/255/);
  });
  it("an unknown type is refused", () => {
    expect(uploadNameProblem("x.html", "text/html")).toMatch(/isn't allowed/);
  });
});

describe("Word / Excel archives", () => {
  it("reads a real workbook's table of contents", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Findings").addRow(["Title"]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    expect(zipEntries(buf)?.some((e) => e.name === "xl/workbook.xml")).toBe(true);
    expect(officeFileProblem(buf, "xlsx")).toBeNull();
  });
  it("accepts a normal .docx / .xlsx", () => {
    expect(officeFileProblem(officeZip("docx"), "docx")).toBeNull();
    expect(officeFileProblem(officeZip("xlsx"), "xlsx")).toBeNull();
  });
  it("refuses macros (a renamed .docm / .xlsm)", () => {
    expect(officeFileProblem(officeZip("docx", [{ name: "word/vbaProject.bin" }]), "docx")).toMatch(/macros/);
    expect(officeFileProblem(officeZip("xlsx", [{ name: "xl/vbaProject.bin" }]), "xlsx")).toMatch(/macros/);
  });
  it("refuses a zip bomb: huge unpacked size, extreme compression or too many parts", () => {
    expect(officeFileProblem(officeZip("xlsx", [{ name: "xl/worksheets/sheet1.xml", data: "x".repeat(1000), unpacked: 500 * 1024 * 1024 }]), "xlsx")).toMatch(/unpacks to more than/);
    expect(officeFileProblem(officeZip("xlsx", [{ name: "xl/worksheets/sheet1.xml", data: "x".repeat(100), unpacked: 1024 * 1024 }]), "xlsx")).toMatch(/compressed in an unusual way/);
    const many = Array.from({ length: 5001 }, (_, i) => ({ name: `xl/p${i}.xml`, data: "x" }));
    expect(officeFileProblem(officeZip("xlsx", many), "xlsx")).toMatch(/too many parts/);
  });
  it("refuses something that isn't a Word / Excel archive", () => {
    expect(officeFileProblem(Buffer.from("PK\u0003\u0004 not really a zip word/"), "docx")).toMatch(/valid/);
    expect(officeFileProblem(makeZip([{ name: "readme.txt" }]), "docx")).toMatch(/Word/);
    expect(officeFileProblem(officeZip("docx"), "xlsx")).toMatch(/Excel/);
  });
});
