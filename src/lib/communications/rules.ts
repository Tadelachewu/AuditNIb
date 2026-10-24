import { countWords, countedChars } from "./plainText";
import { evidenceContentMatchesType } from "@/lib/evidence";
import { officeFileProblem, officeKind, uploadNameProblem } from "@/lib/uploadChecks";
import { ADMIN_ROLE_CODE } from "@/lib/notifications";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import type { Database } from "@/types";
import { ATTACHMENT_TYPES, COMMUNICATIONS_PAGE, LIMITS, selectionMatcher, type RecipientSelection } from "./types";

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
 * Who a new message goes to: "All users", or the ticked roles narrowed to the
 * ticked districts / branches, plus people ticked one by one, minus people
 * unticked (selectionMatcher() in ./types) - only active, non-admin users,
 * never the sender. Sorted by name.
 */
export function resolveRecipients(db: Pick<Database, "users"> & Partial<Pick<Database, "branches">>, selection: RecipientSelection, senderId: string): { id: string; name: string }[] {
  const pool = eligibleRecipients(db, senderId);
  const districtOf = new Map((db.branches ?? []).map((b) => [b.id, b.districtId]));
  // A branch the branches list doesn't know: take its district from its users.
  for (const u of db.users) if (u.branchId && u.districtId && !districtOf.has(u.branchId)) districtOf.set(u.branchId, u.districtId);
  const matches = selectionMatcher(selection, (id) => districtOf.get(id));
  const picked = pool.filter((u) => matches({ id: u.id, roleCode: u.role, districtId: u.districtId ?? null, branchId: u.branchId ?? null }));
  return picked.map((u) => ({ id: u.id, name: u.name })).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * To + Cc of a new message: everyone To reaches, then the Cc'd people who
 * aren't already in To (someone in both is To). No Cc with "Everyone".
 */
export function resolveToAndCc(
  db: Pick<Database, "users"> & Partial<Pick<Database, "branches">>,
  to: RecipientSelection,
  cc: RecipientSelection | undefined,
  senderId: string
): { recipients: { id: string; name: string }[]; ccIds: string[] } {
  const recipients = resolveRecipients(db, to, senderId);
  if (!cc || to.toAll) return { recipients, ccIds: [] };
  const inTo = new Set(recipients.map((r) => r.id));
  const copies = resolveRecipients(db, { ...cc, toAll: false }, senderId).filter((r) => !inTo.has(r.id));
  return { recipients: [...recipients, ...copies], ccIds: copies.map((r) => r.id) };
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

/**
 * Subject and text, trimmed and checked. `words`: the text's words when it's
 * a formatted message (messageWords() - its visible words), else counted from
 * the plain text.
 */
export function messageProblem(subject: string, body: string, words = countWords(body)): string | null {
  // The minimum: spaces and line breaks never count (countedChars()).
  if (!subject.trim()) return "Subject is required";
  if (countedChars(subject) < LIMITS.minText) return `Subject must be at least ${LIMITS.minText} characters (spaces don't count)`;
  if (countedChars(subject) > LIMITS.subject) return `Subject must be at most ${LIMITS.subject} characters`;
  if (!body.trim()) return "Message text is required";
  if (countedChars(body) < LIMITS.minText) return `Message text must be at least ${LIMITS.minText} characters (spaces and line breaks don't count)`;
  if (words > LIMITS.body || body.length > LIMITS.bodyChars) return `Message text must be at most ${LIMITS.body.toLocaleString("en-US")} words`;
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
  if (file.size > LIMITS.attachmentBytes || content.length > LIMITS.attachmentBytes) return `A file must be at most ${LIMITS.attachmentBytes / (1024 * 1024)} MB`;
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
