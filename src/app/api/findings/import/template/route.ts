import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/guard";
import { readDb } from "@/lib/db";
import { buildImportTemplate } from "@/lib/import";

// master.txt §22: "Create standardized import template aligned to Finding
// model" - regenerated from current reference data on every download (not
// a static file) so the "Reference Data" sheet's codes/names never go
// stale relative to what the import route will actually accept.
export async function GET() {
  const auth = await requirePermission("findings.import");
  if (!auth.ok) return auth.response;

  const db = readDb();
  const buffer = await buildImportTemplate(db);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="findings-import-template.xlsx"`,
      "Content-Length": String(buffer.length),
    },
  });
}
