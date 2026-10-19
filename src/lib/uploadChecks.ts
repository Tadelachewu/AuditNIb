/**
 * Server-side checks every uploaded file goes through, on top of each
 * route's own type / size / content rules (EVIDENCE_VALIDATION_RULES.md,
 * docs/communications.md, docs/import.md). Nothing here trusts the browser:
 * the file name, its claimed type and its bytes are all checked on the
 * server, whatever the upload form already checked.
 *
 *   uploadNameProblem    the name: length, no folders or control characters,
 *                        and an extension that matches the file's real type
 *   officeFileProblem    .docx / .xlsx: a real, sane zip archive (entry count,
 *                        unpacked size, compression ratio - "zip bombs") and
 *                        no macros (a renamed .docm / .xlsm)
 */

/** Extensions a stored file's name may have, by its (verified) type. */
const EXTENSIONS_FOR_TYPE: Record<string, string[]> = {
  "application/pdf": ["pdf"],
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "text/csv": ["csv"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
};

export const MAX_FILE_NAME_LENGTH = 255;

/**
 * Why a file's name can't be accepted (null = fine). A name whose extension
 * doesn't match the file's type is refused - otherwise a real PDF uploaded
 * as "report.exe" would be downloaded under that name and opened as a
 * program.
 */
export function uploadNameProblem(fileName: string, mimeType: string): string | null {
  const name = fileName.trim();
  if (!name) return "The file has no name";
  if (name.length > MAX_FILE_NAME_LENGTH) return `The file name must be at most ${MAX_FILE_NAME_LENGTH} characters`;
  if (/[\x00-\x1f\x7f]/.test(name) || /[\\/]/.test(name)) return "The file name contains characters that aren't allowed";
  const allowed = EXTENSIONS_FOR_TYPE[mimeType];
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  if (!allowed || !allowed.includes(extension)) {
    return allowed ? `The file name must end in .${allowed.join(" or .")} for this type of file` : "This type of file isn't allowed";
  }
  return null;
}

export interface ZipLimits {
  /** Most files inside the archive. */
  maxEntries: number;
  /** Most bytes once unpacked, all entries together. */
  maxUnpackedBytes: number;
  /** Highest unpacked / packed ratio of a single entry. */
  maxRatio: number;
}

/** Limits for Word / Excel files: generous for real documents, far below what a zip bomb unpacks to. */
export const OFFICE_ZIP_LIMITS: ZipLimits = { maxEntries: 5000, maxUnpackedBytes: 100 * 1024 * 1024, maxRatio: 200 };

const EOCD = 0x06054b50;
const CENTRAL_HEADER = 0x02014b50;

/**
 * The archive's table of contents (its central directory), read without
 * unpacking anything: each entry's name and packed / unpacked size. null when
 * the bytes aren't a readable zip archive (or use ZIP64, which no real
 * document upload here needs).
 */
export function zipEntries(buf: Buffer): { name: string; packed: number; unpacked: number }[] | null {
  // The end-of-central-directory record sits in the last 22 bytes + an optional comment (up to 64 KB).
  const start = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  const dirSize = buf.readUInt32LE(eocd + 12);
  const dirOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || dirSize === 0xffffffff || dirOffset === 0xffffffff) return null; // ZIP64
  if (dirOffset + dirSize > eocd) return null;

  const entries: { name: string; packed: number; unpacked: number }[] = [];
  let p = dirOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL_HEADER) return null;
    const packed = buf.readUInt32LE(p + 20);
    const unpacked = buf.readUInt32LE(p + 24);
    const nameLength = buf.readUInt16LE(p + 28);
    const extraLength = buf.readUInt16LE(p + 30);
    const commentLength = buf.readUInt16LE(p + 32);
    if (packed === 0xffffffff || unpacked === 0xffffffff) return null; // ZIP64
    const name = buf.subarray(p + 46, p + 46 + nameLength).toString("utf8");
    entries.push({ name, packed, unpacked });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * Why a .docx / .xlsx can't be accepted (null = fine): it must be a readable
 * zip archive within `limits` (so opening it can never exhaust the server's
 * memory), contain the part that makes it a Word / Excel file, and contain
 * no macros.
 */
export function officeFileProblem(buf: Buffer, kind: "docx" | "xlsx", limits: ZipLimits = OFFICE_ZIP_LIMITS): string | null {
  const entries = zipEntries(buf);
  if (!entries) return "The file isn't a valid Word / Excel file";
  if (entries.length > limits.maxEntries) return "The file contains too many parts to be a normal document";
  const unpacked = entries.reduce((sum, e) => sum + e.unpacked, 0);
  if (unpacked > limits.maxUnpackedBytes) return `The file unpacks to more than ${Math.round(limits.maxUnpackedBytes / (1024 * 1024))} MB - it can't be accepted`;
  if (entries.some((e) => e.packed > 0 && e.unpacked / e.packed > limits.maxRatio)) return "The file is compressed in an unusual way and can't be accepted";
  const main = kind === "docx" ? "word/document.xml" : "xl/workbook.xml";
  if (!entries.some((e) => e.name === main)) return `The file isn't a valid ${kind === "docx" ? "Word (.docx)" : "Excel (.xlsx)"} file`;
  // Macros live in a vbaProject.bin part - a renamed .docm / .xlsm. Not accepted.
  if (entries.some((e) => /(^|\/)vbaProject\.bin$/i.test(e.name))) return "Files with macros can't be uploaded - save it as a normal .docx / .xlsx without macros";
  return null;
}

/** The Office kind for a type, if it is one. */
export function officeKind(mimeType: string): "docx" | "xlsx" | null {
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return "xlsx";
  return null;
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
