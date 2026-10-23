"use client";

import { useRef, useState } from "react";
import { FileText, Paperclip, X } from "lucide-react";
import { apiSend, apiUpload } from "@/lib/api-client";
import { notify, notifications } from "@/lib/notify";
import { ATTACHMENT_ACCEPT, ATTACHMENT_TYPES, LIMITS, type AttachmentInfo } from "@/lib/communications/types";

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Attach PDF / Word / Excel files to a message about to be sent: each file is
 * uploaded as soon as it is picked (one request per file - see
 * /api/communications/attachments) and listed with a remove button. The
 * message then refers to the uploaded files by id.
 */
export function AttachmentPicker({
  attachments,
  onChange,
  disabled = false,
  onBusyChange,
  align = "start",
}: {
  attachments: AttachmentInfo[];
  onChange: (next: AttachmentInfo[]) => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  /** "end": the button and the files sit at the right (the compose form's bottom-right). */
  align?: "start" | "end";
}) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const room = LIMITS.attachments - attachments.length - uploading.length;

  async function pick(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    const chosen = Array.from(files);
    if (chosen.length > room) {
      setError(`At most ${LIMITS.attachments} files per message`);
      chosen.splice(room);
    }
    const local: string[] = [];
    for (const f of chosen) {
      if (!ATTACHMENT_TYPES[f.type]) {
        setError(`${f.name}: only PDF, Word (.docx) and Excel (.xlsx) files can be attached`);
        continue;
      }
      if (f.size > LIMITS.attachmentBytes) {
        setError(`${f.name} is larger than ${LIMITS.attachmentBytes / (1024 * 1024)} MB`);
        continue;
      }
      local.push(f.name);
    }
    if (local.length === 0) return;
    setUploading((u) => [...u, ...local]);
    onBusyChange?.(true);
    let next = attachments;
    for (const f of chosen.filter((x) => local.includes(x.name))) {
      const form = new FormData();
      form.append("file", f);
      try {
        const res = await apiUpload<{ attachment: AttachmentInfo }>("/api/communications/attachments", form);
        next = [...next, res.attachment];
        onChange(next);
      } catch (err) {
        setError(notify.formError(err, notifications.communications.uploadFailed));
      } finally {
        setUploading((u) => u.filter((n) => n !== f.name));
      }
    }
    onBusyChange?.(false);
    if (input.current) input.current.value = "";
  }

  async function remove(a: AttachmentInfo) {
    onChange(attachments.filter((x) => x.id !== a.id));
    // Best effort: an unsent upload is also removed by itself after a day.
    apiSend(`/api/communications/attachments/${a.id}`, "DELETE").catch(() => {});
  }

  return (
    <div className={`flex flex-col gap-2 ${align === "end" ? "items-stretch sm:items-end" : ""}`}>
      <div className={`flex flex-wrap items-center gap-2 ${align === "end" ? "sm:flex-row-reverse sm:text-right" : ""}`}>
        <input
          ref={input}
          type="file"
          multiple
          accept={ATTACHMENT_ACCEPT}
          className="hidden"
          onChange={(e) => void pick(e.target.files)}
          disabled={disabled || room <= 0}
        />
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={disabled || room <= 0}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
        >
          <Paperclip className="h-4 w-4" />
          Attach files
        </button>
        <span className="text-xs text-slate-500">PDF, Word (.docx) or Excel (.xlsx) - up to {LIMITS.attachments} files, {LIMITS.attachmentBytes / (1024 * 1024)} MB each</span>
      </div>
      {(attachments.length > 0 || uploading.length > 0) && (
        <ul className={`flex flex-col gap-1 ${align === "end" ? "w-full sm:w-80" : ""}`}>
          {attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-2 rounded-md border border-slate-200 px-2 py-1 text-sm">
              <FileText className="h-4 w-4 shrink-0 text-sky-600" />
              <span className="min-w-0 flex-1 truncate text-slate-800">{a.fileName}</span>
              <span className="shrink-0 text-xs text-slate-500">{formatBytes(a.size)}</span>
              <button type="button" onClick={() => void remove(a)} disabled={disabled} className="shrink-0 rounded p-0.5 text-slate-500 hover:bg-slate-100 hover:text-red-600" aria-label={`Remove ${a.fileName}`}>
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
          {uploading.map((name) => (
            <li key={`up-${name}`} className="flex items-center gap-2 rounded-md border border-dashed border-slate-300 px-2 py-1 text-sm text-slate-500">
              <FileText className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{name}</span>
              <span className="shrink-0 text-xs">Uploading…</span>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
