import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/guard";
import { readDb } from "@/lib/db";
import { MAX_IMPORT_BYTES } from "@/lib/import";
import { runImport } from "@/lib/importRun";
import { isRateLimited, recordAttempt } from "@/lib/rateLimit";
import { RateLimitError, ValidationError } from "@/lib/errors";
import { withApiHandler } from "@/lib/api/handler";
import { listPageJson } from "@/lib/serverList";

// Per-user cap on import attempts (each parses a whole workbook).
const IMPORT_UPLOAD_LIMIT = { max: 10, windowMs: 10 * 60 * 1000 };

// master.txt §22's import history - every past run, kept permanently
// ("document any transformation") rather than only the response of the
// request that created it.
async function handleGET(request: Request) {
  // Reverse-only holders need the history too, to find the batch to reverse.
  const auth = await requirePermission("findings.import", "findings.reverse-import");
  if (!auth.ok) return auth.response;

  const db = await readDb();
  const batches = [...db.importBatches].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // ?page=... -> one page of the Import History (newest first).
  const paged = listPageJson(request, "importBatches", batches, { fields: { createdAt: (b) => b.createdAt } });
  if (paged) return NextResponse.json(paged);
  return NextResponse.json({ importBatches: batches });
}

// HO Internal Controller's bulk sibling of POST /api/findings (single-
// record create) - master.txt §22: "HO Internal Controllers can
// import/enter Internal Audit findings." The whole pipeline (all-or-
// nothing validation, duplicates as the final decision, commit) lives in
// runImport() (src/lib/importRun.ts), shared with Re-import.
//
// Form fields: file (.xlsx); duplicates=import once the importer has seen
// the IMPORT_DUPLICATES_FOUND evidence and chose "Import anyway".
async function handlePOST(request: Request) {
  const auth = await requirePermission("findings.import");
  if (!auth.ok) return auth.response;

  const rateKey = `import-upload:${auth.session.userId}`;
  const limited = await isRateLimited(rateKey, IMPORT_UPLOAD_LIMIT);
  if (limited.limited) throw new RateLimitError(limited.retryAfterSeconds, `Too many import attempts - please wait ${Math.ceil(limited.retryAfterSeconds / 60)} minute(s) and try again.`);
  await recordAttempt(rateKey, IMPORT_UPLOAD_LIMIT);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    throw new ValidationError("File exceeds the 10 MB limit");
  }
  const file = formData.get("file");
  if (!file || !(file instanceof File)) throw new ValidationError("No file provided");
  if (file.size > MAX_IMPORT_BYTES) throw new ValidationError("File exceeds the 10 MB limit");

  const batch = await runImport(
    Buffer.from(await file.arrayBuffer()),
    file.name,
    {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      orgScope: auth.session.orgScope!,
      districtId: auth.session.districtId ?? null,
      branchId: auth.session.branchId ?? null,
    },
    { importDuplicates: formData.get("duplicates") === "import" }
  );
  return NextResponse.json({ importBatch: batch }, { status: 201 });
}

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const GET = withApiHandler(handleGET);
export const POST = withApiHandler(handlePOST);
