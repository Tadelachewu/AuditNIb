# Files: Uploads, Storage, Retrieval and Security

This page explains which files users can upload, where and how they're kept, how to get them back, how they're protected, and how to set up storage on a new install.

---

## 1. Every place a file can be uploaded

| Where | What | Kept? | Who can upload (default roles) |
|---|---|---|---|
| **Finding page → Evidence** | Supporting documents attached to a finding | ✅ encrypted, in `storage/evidence/` | Needs **Findings › Upload Evidence**: Branch Controller, Branch Manager, Branch Sub-Manager, Administrator |
| **Comments** | ❌ **No files, comments are text only.** Attachments stored on comments before this change still show under their comment and can be downloaded or removed. | n/a | n/a |
| **Import Findings** (`/findings/import`) | The `.xlsx` sheet of findings to bulk-register | ✅ **the original spreadsheet** of every successful import, encrypted, in `storage/imports/` | Needs **Findings › Bulk Import**: HO Controller, Administrator |

**Not files, even though the names suggest it:**
- **Evidence note** is a *text* field on the finding.
- **Support messages** are text only.
- **Downloads the app generates** (the Import template, the Findings CSV export, report exports) are created on request and not stored.

A **rejected** import (one with row errors) changes nothing and isn't kept.

---

## 2. How files are stored

### 2.1 The dedicated storage folder

All uploaded files live in **one dedicated folder**, separate from the app's code and from the database:

```
storage/                      ← STORAGE_DIR (default: "storage" next to the app)
  evidence/<random-id>.<ext>  ← evidence (and older comment attachments)
  imports/<random-id>.xlsx    ← original import spreadsheets
```

- **Location:** set **`STORAGE_DIR`** in `.env` to put it anywhere: a dedicated disk or volume, or a **network share** mounted on every app server if you run more than one. If it's not set, it's `storage/` next to the app.
- **Filenames:** every file is saved under a **random ID** the server creates, never the uploader's filename.
- **Permissions:** folders are created owner-only (`700`) and files owner-only (`600`), so on Linux only the app's own account can read them.
- **Git:** the folder is excluded from git (`/storage/` in `.gitignore`).
- **Safe writes:** each file is written to a temporary name and then renamed, so a crash mid-write never leaves a half-written file under a real name.

### 2.2 Encryption at rest

**Every stored file is encrypted** with **AES-256-GCM** before it's written to disk.

- **The key** is **`FILE_ENCRYPTION_KEY`** in the server's `.env`: 32 random bytes, base64-encoded. It's **never stored in the storage folder**, so a copy of the folder, a stolen disk or a backup of the files alone can't be read.
- **Tamper detection:** GCM also verifies each file on the way out. A file that was altered on disk, or read with the wrong key, is refused with an error instead of being served corrupted.
- **Legacy files:** files stored before encryption existed are still read transparently. `npm run storage:migrate` encrypts them (§6).

> ⚠️ **Back up the key separately from the files, and never change it once files exist.** Without the exact key the stored files can't be decrypted by anyone, including you.

If `FILE_ENCRYPTION_KEY` isn't set, uploads are refused with a clear "File storage isn't configured" message rather than being stored unencrypted.

### 2.3 The records about the files: the database

| Table | One row per | Key columns |
|---|---|---|
| **`evidence`** | Evidence file (or an older comment attachment) | `finding_id`, `comment_id` (empty for finding-level evidence), `file_name` (**original** name), `mime_type`, `size`, `storage_path` (the random name in `storage/evidence/`), `uploaded_by`, `created_at` |
| **`import_batches`** | Import run | `file_name` (original name), `stored_file` (the random name in `storage/imports/`; empty for imports made before originals were kept), row counts and outcomes |

The **file** is in the storage folder and its **description** is in the database. A complete backup needs both (§3.4).

---

## 3. Getting files back

### 3.1 In the app

- **Evidence and attachments:** on the finding page, each file is a download link and downloads under its **original name**. Anyone who can **view** that finding can download it (Findings › View, within their branch, district or bank-wide scope).
- **Import originals:** **Import Findings → Import History → Download file** on each import. Needs Findings › Bulk Import. (Imports made before this feature show no Download link; their file wasn't kept.)

Files are decrypted on the fly for the download. Every download is recorded in the audit log (§4).

### 3.2 Everything at once: `storage:export`

Stored files are encrypted, so **copying the storage folder doesn't give usable files.** Export them decrypted instead, on the server:

```bash
npm run storage:export -- C:\evidence-export
```

The result:

```
C:\evidence-export\
  evidence\NIB-AA-2026-0001\3f2b9c1e_Cash count sheet.pdf
  evidence\NIB-AA-2026-0001\7a4d0b77_Photo.jpg
  imports\2026-09-28_5c1e0a2b_September findings.xlsx
```

Files are grouped by finding reference, under their original names. The short ID prefix keeps two uploads with the same name from overwriting each other. The tool needs `FILE_ENCRYPTION_KEY` and database access from `.env`.

> Treat the export folder as **sensitive**. Its files are no longer encrypted.

### 3.3 Finding a file's details (SQL)

```sql
SELECT f.reference, e.file_name AS original_name, e.storage_path, e.mime_type,
       e.size, e.uploaded_by_name, e.created_at,
       CASE WHEN e.comment_id IS NULL THEN 'Evidence' ELSE 'Comment attachment' END AS kind
FROM   evidence e JOIN findings f ON f.id = e.finding_id
ORDER  BY f.reference, e.created_at;
```

### 3.4 Backups

A complete backup has **three** parts:
1. the PostgreSQL database (`pg_dump`)
2. the storage folder (`STORAGE_DIR`)
3. **`FILE_ENCRYPTION_KEY`**, kept somewhere safe and separate, such as a password manager or vault

Take 1 and 2 at the same time so the records and the files match. Without 3, the files in 2 are unreadable.

---

## 4. Security measures

### 4.1 Evidence

The full, rule-by-rule list with error messages and code references is in [EVIDENCE_VALIDATION_RULES.md](../EVIDENCE_VALIDATION_RULES.md).

| Protection | What it does |
|---|---|
| **Signed-in users only** | Every upload, list, download and delete request needs a valid session. |
| **Evidence only** | Files can only be attached as evidence. Uploads naming a comment are refused, since comments are text only. |
| **Permission check** | **Upload:** Findings › Upload Evidence. **Download:** Findings › View. **Delete:** see §5. |
| **Scope check** | The finding must be inside the user's own branch or district (bank-wide roles: any). A guessed link to another area's finding is refused. |
| **Link-to-finding check** | A download or delete must name both the finding and the file, and they must belong together. |
| **Allowed types only** | PDF, PNG, JPG, XLSX, DOCX and CSV. Everything else is refused, including HTML, scripts, executables and SVG. |
| **Content check (magic bytes)** | The file's real first bytes must match the claimed type. For example, a PDF must start with `%PDF-`, and DOCX/XLSX must be real Office packages. A renamed HTML or executable file is refused. |
| **Size limit** | 10 MB per file. |
| **Upload rate limit** | At most **30 uploads per user per 10 minutes**. Beyond that the user is asked to wait. |
| **Random stored names + name check** | Files are stored under server-generated random IDs, and the storage code refuses any other name. No user input can reach a file path. |
| **Encrypted at rest** | AES-256-GCM with a key that's not in the storage folder (§2.2). |
| **Tamper detection** | A file altered on disk fails its integrity check and isn't served. |
| **Not publicly reachable** | The storage folder isn't served by the website. Files are only reachable through the checked download route. |
| **Always a download, never opened in the browser** | Sent as `Content-Disposition: attachment`, with the correct original filename (including spaces and Amharic, via the RFC 5987 `filename*` form), and never cached (`Cache-Control: private, no-store`). |
| **No type guessing / strict page policy** | `X-Content-Type-Options: nosniff` and the app's Content-Security-Policy apply to every response. |
| **Audit log** | Every **upload**, **download** and **delete** is recorded (§4.3). |
| **No orphans** | Deleting a file, or a whole finding, also deletes the stored file. A failed save never leaves a file behind. `storage:cleanup` finds any leftovers (§6). |

### 4.2 Import files

| Protection | What it does |
|---|---|
| **Permission** | Findings › Bulk Import is required to import, see the history, and download originals. |
| **Limits** | 10 MB per file, at most 2,000 rows, and at most **10 import attempts per user per 10 minutes**. |
| **Must be a real workbook** | Files the spreadsheet reader can't open are refused. |
| **Every row validated, all-or-nothing** | Rows are checked against the same rules as the Register Finding form and the importer's own scope. If any row has an error, nothing is imported. |
| **Original kept, encrypted** | Every successful import's spreadsheet is stored encrypted in `storage/imports/`. |
| **Audit log** | Each import run and each original-file download is recorded. |

### 4.3 What the audit log records (Admin → Audit Log)

| Action | Recorded when | Details kept |
|---|---|---|
| `EVIDENCE_UPLOAD` | A file is uploaded | finding reference, comment (if any), file name, type, size |
| `EVIDENCE_DOWNLOAD` | A file is downloaded | finding reference, file name |
| `EVIDENCE_DELETE` | A file is removed | finding reference, file name, original uploader |
| `IMPORT` | An import succeeds | file name, row counts |
| `IMPORT_FILE_DOWNLOAD` | An import's original is downloaded | file name |
| `DELETE` (Finding) | A finding is deleted | the finding, and the names of the files deleted with it |

Each entry also records who did it and when. The audit log is tamper-evident (hash-chained).

---

## 5. Removing files

A small **trash icon** next to a file on the finding page removes it after a confirmation. It shows only to users who are allowed to remove that file:

| Who | Can remove |
|---|---|
| **The uploader** | Their **own** file, while the finding **isn't closed**. They also need the upload permission for that kind of file (Upload Evidence, or Comment for attachments). |
| Holders of **Findings › Delete Any Evidence** | **Anyone's** file, at any status, for housekeeping such as a wrong or sensitive file. Administrator has it by default; grant it to other roles in Roles & Permissions if needed. |

Both still need the finding to be in their branch or district. Removing deletes the record **and** the stored file, and writes an `EVIDENCE_DELETE` audit entry.

Deleting a **finding** (drafts and rejected findings only) removes all its files too.

---

## 6. Maintenance tools

Run these on the server, from the app's folder. They read `.env`.

| Command | What it does |
|---|---|
| `npm run storage:migrate` | Moves files from the **old location** (`data/uploads/`) into `storage/evidence/` with encryption, and encrypts any stored file that's still plain. Safe to run more than once. |
| `npm run storage:cleanup` | **Reports** stored files that no record points to (orphans), and records whose file is missing. Changes nothing. |
| `npm run storage:cleanup -- --delete` | Also **deletes** those orphans. |
| `npm run storage:export -- <folder>` | Exports every file **decrypted**, under its original name (§3.2). |

---

## 7. Setting up storage on a new or existing install

1. **Generate a key once** and put it in the server's `.env`:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
   ```
   FILE_ENCRYPTION_KEY=<the value printed above>
   ```
   **Save a copy somewhere safe**, separately from the server (§3.4).
2. *(Optional)* choose where files go: `STORAGE_DIR=D:\nib-storage`, or a mounted network share. Otherwise it's `storage\` next to the app.
3. Apply the database update: `npx prisma migrate deploy` (adds `import_batches.stored_file`).
4. If the install already has uploads in `data/uploads/`, run `npm run storage:migrate` once.
5. **Restart the app** (`next dev` / `next start`) so it picks up the new `.env` values.

---

## 8. Remaining gap

| Gap | Risk | Recommendation |
|---|---|---|
| **No virus or malware scanning.** Allowed file types can still carry malicious content, such as a PDF exploit or a Word macro. | A user downloads and opens an infected file. | Scan on upload (for example ClamAV) before `writeStoredFile`, or rely on endpoint antivirus on staff PCs and document that policy. |

---

## 9. For developers

| File | Role |
|---|---|
| `src/lib/fileStorage.ts` | **The only code that touches stored files:** storage folder, encryption and decryption, safe names, write/read/delete, download filename header |
| `src/lib/evidence.ts` | Upload validation: allowed types, content (magic-byte) check, size and rate limits |
| `src/app/api/findings/[id]/evidence/route.ts` | Upload (`POST`), list (`GET`) |
| `src/app/api/findings/[id]/evidence/[evidenceId]/route.ts` | Download (`GET`), remove (`DELETE`) |
| `src/app/api/findings/import/route.ts` | Import; stores the original |
| `src/app/api/findings/import/[batchId]/file/route.ts` | Download an import's original |
| `src/app/api/findings/[id]/route.ts` | Finding delete; also deletes its files |
| `scripts/storage-*.ts` | The `storage:migrate`, `storage:cleanup` and `storage:export` tools |

- **Adding an allowed upload type:** add it to `ALLOWED_EVIDENCE_TYPES` **and** give it a content check in `EVIDENCE_SIGNATURES` (`src/lib/evidence.ts`).
- **Moving to object storage (S3 or similar):** reimplement `writeStoredFile`, `readStoredFile`, `deleteStoredFile` and `listStoredFiles` in `src/lib/fileStorage.ts`. Nothing else reads or writes files.
