# Evidence Upload: Validation Rules

This document covers every check applied when a file is uploaded as **evidence** on a finding (**Finding page → Evidence → choose a file**). The checks run in the order listed, and the first failure stops the upload with the error shown.

**Scope:**
1. Where files can be uploaded (§1)
2. Request-level rules: who, which finding, how often (§2)
3. File-level rules: presence, type, size, real content (§3)
4. Storage rules applied once a file passes (§4)
5. Download and removal rules (§5)

Every rule is traced to its implementing lines in
[src/app/api/findings/[id]/evidence/route.ts](src/app/api/findings/[id]/evidence/route.ts),
[src/lib/evidence.ts](src/lib/evidence.ts) and
[src/lib/fileStorage.ts](src/lib/fileStorage.ts).
For import spreadsheets, see [IMPORT_VALIDATION_RULES.md](IMPORT_VALIDATION_RULES.md). For storage, retrieval and backups, see [docs/files.md](docs/files.md).

---

## 1. Where files can be uploaded

| Place | Files allowed? |
|---|---|
| Finding page → **Evidence** section | ✅ Yes, the **only** place |
| **Comments and replies** | ❌ **No, comments are text only.** There's no file picker, and the API refuses any upload that names a comment (rule R3). |

Attachments stored on comments **before** comments became text-only still appear under their comment. They can still be downloaded, and removed under the rules in §5.2.

---

## 2. Request-level rules

| # | Rule | On failure | Code |
|---|---|---|---|
| R1 | **Signed in.** A valid session is required. | `401` "Not authenticated" | [route.ts:27](src/app/api/findings/[id]/evidence/route.ts#L27) |
| R2 | **Readable upload.** The request must be a multipart form the runtime can parse. The runtime's own body limit rejects a request much over 10 MB at this point, which is why this failure is reported as a size error. | `400` "File exceeds the 10 MB limit" | [route.ts:31-35](src/app/api/findings/[id]/evidence/route.ts#L31-L35) |
| R3 | **Not a comment attachment.** An upload carrying a `commentId` field is refused; comments are text only. | `400` "Comments are text only - attach files in the finding's Evidence section instead." | [route.ts:38-43](src/app/api/findings/[id]/evidence/route.ts#L38-L43) |
| R4 | **Permission.** The user's role must hold **Findings › Upload Evidence** (`findings.evidence`). By default: Branch Controller, Branch Manager, Branch Sub-Manager, Administrator. | `403` "Forbidden" | [route.ts:45](src/app/api/findings/[id]/evidence/route.ts#L45) |
| R5 | **Rate limit.** At most **30 uploads per user per 10 minutes**. Only successfully stored files count toward the limit. If the rate-limit store (Redis) is unavailable, the check is skipped rather than blocking uploads. | `429` "Too many uploads - please wait N minute(s) and try again." plus a `Retry-After` header | [route.ts:52](src/app/api/findings/[id]/evidence/route.ts#L52), [evidence.ts:18](src/lib/evidence.ts#L18) |
| R6 | **Finding exists.** | `404` "Finding not found" | [route.ts:62](src/app/api/findings/[id]/evidence/route.ts#L62) |
| R7 | **Finding in the user's scope.** Branch roles may only upload to their own branch's findings, district roles to their own district's; bank-wide roles to any. | `403` with the scope reason | [route.ts:64](src/app/api/findings/[id]/evidence/route.ts#L64) |

---

## 3. File-level rules

| # | Rule | On failure | Code |
|---|---|---|---|
| F1 | **A file is present** in the `file` field. | `400` "No file provided" | [route.ts:70](src/app/api/findings/[id]/evidence/route.ts#L70) |
| F2 | **Allowed type.** The declared type must be one of the six below. Everything else is refused, including HTML, JavaScript, executables, archives (`.zip`), SVG, old Office formats (`.doc`, `.xls`) and plain text other than CSV. | `400` "Unsupported file type. Allowed: PDF, PNG, JPG, XLSX, DOCX, CSV" | [route.ts:73-79](src/app/api/findings/[id]/evidence/route.ts#L73-L79), [evidence.ts:7](src/lib/evidence.ts#L7) |
| F3 | **Size ≤ 10 MB** (10,485,760 bytes). | `400` "File exceeds the 10 MB limit" | [route.ts:80](src/app/api/findings/[id]/evidence/route.ts#L80), [evidence.ts:5](src/lib/evidence.ts#L5) |
| F4 | **Real content matches the declared type.** The type a browser reports is only a label the client chose, so the file's actual first bytes are checked against the table below. This catches, for example, an HTML page or an executable renamed to `.pdf`. | `400` "File content doesn't match its declared type. Allowed: PDF, PNG, JPG, XLSX, DOCX, CSV" | [route.ts:89](src/app/api/findings/[id]/evidence/route.ts#L89), [evidence.ts:50-63](src/lib/evidence.ts#L50-L63) |

### 3.1 Allowed types and their content checks (F2 + F4)

| Type | Declared MIME type | Saved as | Content check (the file must…) |
|---|---|---|---|
| **PDF** | `application/pdf` | `.pdf` | start with `%PDF-` |
| **PNG** | `image/png` | `.png` | start with the 8-byte PNG signature `89 50 4E 47 0D 0A 1A 0A` |
| **JPEG** | `image/jpeg` | `.jpg` | start with `FF D8 FF` |
| **Excel** | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | `.xlsx` | be a zip package (`PK\x03\x04` or `PK\x05\x06`) that contains an `xl/` part |
| **Word** | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | `.docx` | be a zip package that contains a `word/` part |
| **CSV** | `text/csv` | `.csv` | look like plain text: no NUL or other control bytes (except tab, line feed, carriage return) in the first 4 KB |

- **The saved extension comes from the allowed type,** never from the uploaded filename. A file called `report.pdf.exe` declared as PDF is saved as `.pdf` only if its content really is a PDF.
- **Adding a type** requires an entry in **both** `ALLOWED_EVIDENCE_TYPES` and `EVIDENCE_SIGNATURES`. A type without a content check is always refused ([evidence.ts:61-63](src/lib/evidence.ts#L61-L63)).

### 3.2 What is *not* checked

- **Malware / viruses.** Allowed types can still carry malicious content, such as a PDF exploit or a macro-enabled document saved as `.docx`. There's no antivirus scan; see [docs/files.md §8](docs/files.md).
- **Filename content.** The original name is kept only for display and download. It's never used for storage, so no filename can affect where or how a file is stored.
- **Duplicates.** Uploading the same file twice stores it twice.

---

## 4. Storage rules (after all checks pass)

| # | Rule | Code |
|---|---|---|
| S1 | **Random stored name.** The file is saved as `<random UUID>.<allowed extension>`, never under the uploaded name. The storage code refuses any name not in that exact format, so no input can reach a file path. | [fileStorage.ts:34](src/lib/fileStorage.ts#L34), [fileStorage.ts:47](src/lib/fileStorage.ts#L47) |
| S2 | **Encrypted at rest** with AES-256-GCM, using `FILE_ENCRYPTION_KEY`. If the key isn't configured, the upload fails with `500` "File storage isn't configured…" instead of storing an unencrypted file. | [fileStorage.ts:76](src/lib/fileStorage.ts#L76), [route.ts:99](src/app/api/findings/[id]/evidence/route.ts#L99) |
| S3 | **Safe write.** The file is written to a temporary name and then renamed, with owner-only permissions, in `<STORAGE_DIR>/evidence/`. | [fileStorage.ts:96](src/lib/fileStorage.ts#L96) |
| S4 | **Record + audit entry together.** The `evidence` record and an `EVIDENCE_UPLOAD` audit log entry are saved in the same database write. It keeps the finding reference, file name, type, size, uploader and time. | [route.ts:127](src/app/api/findings/[id]/evidence/route.ts#L127) |
| S5 | **No orphans.** If saving the record fails, the stored file is deleted again. | [route.ts:136](src/app/api/findings/[id]/evidence/route.ts#L136) |

---

## 5. Download and removal rules

### 5.1 Download (`GET …/evidence/<evidenceId>`)

| Rule | On failure |
|---|---|
| Signed in and holds **Findings › View** | `401` / `403` |
| Finding exists and is in the user's scope | `404` / `403` |
| The file record belongs to that finding | `404` "Evidence not found" |
| The stored file exists and decrypts with a valid integrity check. A file altered on disk, or the wrong key, is refused. | `404` "File is missing from storage" / `500` integrity error |

A successful download:
- is always sent as a **download, never displayed in the browser** (`Content-Disposition: attachment`);
- uses the **original filename**, including spaces and Amharic;
- is **never cached** (`Cache-Control: private, no-store`);
- is recorded as `EVIDENCE_DOWNLOAD` in the audit log.

Code: [[evidenceId]/route.ts:14](src/app/api/findings/[id]/evidence/[evidenceId]/route.ts#L14).

### 5.2 Removal (`DELETE …/evidence/<evidenceId>`)

| Who | Allowed when |
|---|---|
| The **uploader** | It's their own file, they still hold the matching upload permission (Upload Evidence; for an older comment attachment, Comment), and the finding is **not closed** |
| Holders of **Findings › Delete Any Evidence** | Any file, any status |

Both require the finding to be in the user's scope. Otherwise the request fails with `403` and the reason ("You can only remove files you uploaded yourself" or "This finding is closed…"). A successful removal deletes the record **and** the stored file, and writes an `EVIDENCE_DELETE` audit entry.

Code: [[evidenceId]/route.ts:66](src/app/api/findings/[id]/evidence/[evidenceId]/route.ts#L66).

---

## 6. Limits at a glance

| Limit | Value | Where to change |
|---|---|---|
| Max file size | 10 MB | `MAX_EVIDENCE_BYTES`, `src/lib/evidence.ts` |
| Upload rate | 30 per user per 10 minutes | `EVIDENCE_UPLOAD_LIMIT`, `src/lib/evidence.ts` |
| Allowed types | PDF, PNG, JPG, XLSX, DOCX, CSV | `ALLOWED_EVIDENCE_TYPES` + `EVIDENCE_SIGNATURES`, `src/lib/evidence.ts` |
