import { evidenceContentMatchesType } from "@/lib/evidence";
import { officeFileProblem, officeKind, uploadNameProblem } from "@/lib/uploadChecks";
import { ADMIN_ROLE_CODE } from "@/lib/notifications";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import type { Database } from "@/types";
import { ATTACHMENT_TYPES, COMMUNICATIONS_PAGE, LIMITS, type RecipientSelection } from "./types";

/**
 * Pure rules of Communications (docs/communications.md): who may use it, who
 * a message reaches, replies, withdrawal and the email text. No storage, no
 * side effects.
 */

type Caller = { userId?: string; role?: string; permissions?: string[] };

/** May open Communications at all: holds Communications > View and isn't an administrator. */
export function canUseCommunications(session: Caller): boolean {
  return Boolean(session.userId) && session.role !== ADMIN_ROLE_CODE && hasPermission(session.permissions, permissionKey(COMMUNICATIONS_PAGE, "view"));
}

/** May send (new messages and replies): also holds Communications > Send. */
export function canSendCommunications(session: Caller): boolean {
  return canUseCommunications(session) && hasPermission(session.permissions, permissionKey(COMMUNICATIONS_PAGE, "send"));
}

/** Users a message can reach: active, not an administrator, not the sender. */
export function eligibleRecipients(db: Pick<Database, "users">, senderId: string): Database["users"] {
  return db.users.filter((u) => u.status === "ACTIVE" && u.role !== ADMIN_ROLE_CODE && u.id !== senderId);
}

/**
 * Who a new message goes to: "All users", or the union of the picked users,
 * roles, districts and branches - each expanded to its active, non-admin
 * users (never the sender). Sorted by name.
 */
export function resolveRecipients(db: Pick<Database, "users">, selection: RecipientSelection, senderId: string): { id: string; name: string }[] {
  const pool = eligibleRecipients(db, senderId);
  const picked = selection.toAll
    ? pool
    : pool.filter(
        (u) =>
          selection.userIds.includes(u.id) ||
          selection.roleCodes.includes(u.role) ||
          (u.districtId != null && selection.districtIds.includes(u.districtId)) ||
          (u.branchId != null && selection.branchIds.includes(u.branchId))
      );
  return picked.map((u) => ({ id: u.id, name: u.name })).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Who a reply goes to.
 *   Reply      the message's sender; when you reply to your own message, its recipients.
 *   Reply all  the sender and every recipient, except yourself - not offered
 *              for an "All users" message (it would message everyone again).
 * Only people who can still receive messages (active, not administrators).
 */
export function replyRecipients(
  db: Pick<Database, "users">,
  message: { senderId: string; toAll: boolean; recipientIds: string[] },
  viewerId: string,
  all: boolean
): { id: string; name: string }[] | { error: string } {
  if (all && message.toAll) return { error: "Reply all isn't available for a message sent to all users - use Reply" };
  const ids = new Set<string>();
  if (all) {
    ids.add(message.senderId);
    message.recipientIds.forEach((id) => ids.add(id));
  } else if (message.senderId === viewerId) {
    if (message.toAll) return { error: "To follow up a message sent to all users, send a new message" };
    message.recipientIds.forEach((id) => ids.add(id));
  } else {
    ids.add(message.senderId);
  }
  ids.delete(viewerId);
  const pool = eligibleRecipients(db, viewerId).filter((u) => ids.has(u.id));
  if (pool.length === 0) return { error: "Nobody on this conversation can receive messages any more" };
  return pool.map((u) => ({ id: u.id, name: u.name })).sort((a, b) => a.name.localeCompare(b.name));
}

/** The subject of a reply: "Re: <subject>", never "Re: Re: ...". */
export function replySubject(subject: string): string {
  const base = subject.replace(/^(re:\s*)+/i, "").trim();
  return `Re: ${base}`.slice(0, LIMITS.subject);
}

/** Subject and text, trimmed and checked. Plain text only. */
export function messageProblem(subject: string, body: string): string | null {
  if (!subject.trim()) return "Subject is required";
  if (subject.trim().length > LIMITS.subject) return `Subject must be at most ${LIMITS.subject} characters`;
  if (!body.trim()) return "Message text is required";
  if (body.trim().length > LIMITS.body) return `Message text must be at most ${LIMITS.body} characters`;
  return null;
}

/**
 * Why an uploaded file can't be attached (null = fine). Checked on the server
 * whatever the browser already checked: the type, the size, the real content
 * (the bytes must match the claimed type), the name (its extension must match
 * the type), and for Word / Excel a sane archive with no macros.
 */
export function attachmentProblem(file: { name: string; type: string; size: number }, content: Buffer): string | null {
  if (!ATTACHMENT_TYPES[file.type]) return "Only PDF, Word (.docx) and Excel (.xlsx) files can be attached";
  if (file.size > LIMITS.attachmentBytes || content.length > LIMITS.attachmentBytes) return "A file must be at most 10 MB";
  if (file.size === 0 || content.length === 0) return "The file is empty";
  // The type the browser claims is not trusted: the bytes must match it (same check as evidence).
  if (!evidenceContentMatchesType(content, file.type)) return "The file's content doesn't match its type - only real PDF, Word (.docx) and Excel (.xlsx) files can be attached";
  const nameProblem = uploadNameProblem(file.name, file.type);
  if (nameProblem) return nameProblem;
  const office = officeKind(file.type);
  return office ? officeFileProblem(content, office) : null;
}

/** A sender may withdraw a message within LIMITS.withdrawMinutes, while no recipient has opened it. */
export function canWithdraw(message: { senderId: string; createdAt: string; withdrawnAt: string | null }, viewerId: string, readCount: number, now = Date.now()): boolean {
  if (message.senderId !== viewerId || message.withdrawnAt || readCount > 0) return false;
  return now - new Date(message.createdAt).getTime() <= LIMITS.withdrawMinutes * 60 * 1000;
}

/** The body, shortened for the bell notification and the lists. */
export function previewOf(body: string, length: number = LIMITS.preview): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
}

/** The email text: who sent it, the whole message, and the attachment names (the files stay in the app). */
export function emailText(senderName: string, body: string, attachmentNames: string[]): string {
  const files = attachmentNames.length > 0 ? `\n\nAttachments (open the message in NIB Control360 to download):\n${attachmentNames.map((n) => `- ${n}`).join("\n")}` : "";
  return `From: ${senderName}\n\n${body.trim()}${files}`;
}
