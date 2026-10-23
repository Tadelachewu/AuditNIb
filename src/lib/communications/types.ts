/**
 * Communications (docs/communications.md) - messages between users, to all
 * users or selected users, with optional PDF / Word / Excel attachments.
 * Administrators are excluded entirely (they can't send, receive or open
 * messages). Client-safe: types and constants only.
 */

export const COMMUNICATIONS_PAGE = "communications";

export const LIMITS = {
  subject: 200,
  body: 10_000,
  /** At least this many characters in the subject and in the message text. */
  minText: 3,
  /** Attachments per message. */
  attachments: 10,
  /** Bytes for ALL of a message's attachments together (each upload is one file, never more than this). */
  attachmentBytes: 25 * 1024 * 1024,
  /** A sender can withdraw a message this long after sending it, while nobody has opened it. */
  withdrawMinutes: 10,
  /** Bell notification preview of the body (the email carries the whole text). */
  preview: 300,
  /** The formatted message's HTML (the 10,000-character limit applies to its text). */
  html: 120_000,
} as const;

/** Allowed attachment types: PDF, Word (.docx), Excel (.xlsx). */
export const ATTACHMENT_TYPES: Record<string, { extension: string; label: string }> = {
  "application/pdf": { extension: "pdf", label: "PDF" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { extension: "docx", label: "Word" },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { extension: "xlsx", label: "Excel" },
};
export const ATTACHMENT_ACCEPT = ".pdf,.docx,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Who a new message goes to (selectionMatcher() below). Groups are expanded
 * to their active, non-admin users when sent.
 */
export interface RecipientSelection {
  toAll: boolean;
  /** People ticked one by one - always included. */
  userIds: string[];
  roleCodes: string[];
  districtIds: string[];
  branchIds: string[];
  /** People unticked from the ticked groups. */
  excludedUserIds?: string[];
}

/** What a recipient is matched on. */
export interface RecipientFacts {
  id: string;
  roleCode: string;
  districtId: string | null;
  branchId: string | null;
}

/**
 * Does this user receive the message? The one rule for the server
 * (resolveRecipients) and the "To" picker's live count, so they always agree:
 * - ticks within one category add up (Branch Manager OR District Controller);
 * - ticks across categories narrow (those roles IN the ticked districts /
 *   branches). A ticked branch refines its district: once a branch of a
 *   ticked district is ticked, only the ticked branches of it count;
 * - people ticked one by one are always included; people unticked from the
 *   groups are left out.
 */
export function selectionMatcher(selection: RecipientSelection, districtOfBranch: (branchId: string) => string | null | undefined): (u: RecipientFacts) => boolean {
  const users = new Set(selection.userIds);
  const excluded = new Set(selection.excludedUserIds ?? []);
  const roles = new Set(selection.roleCodes);
  const districts = new Set(selection.districtIds);
  const branches = new Set(selection.branchIds);
  const refined = new Set(selection.branchIds.map(districtOfBranch).filter((d): d is string => Boolean(d)));
  const anyGroup = roles.size + districts.size + branches.size > 0;
  const anyPlace = districts.size + branches.size > 0;
  return (u) => {
    if (selection.toAll || users.has(u.id)) return true;
    if (!anyGroup || excluded.has(u.id)) return false;
    if (roles.size > 0 && !roles.has(u.roleCode)) return false;
    if (!anyPlace) return true;
    if (u.branchId && branches.has(u.branchId)) return true;
    return u.districtId != null && districts.has(u.districtId) && !refined.has(u.districtId);
  };
}

export interface AttachmentInfo {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
}

/** One line of the Inbox. */
export interface InboxItem {
  id: string;
  threadId: string;
  subject: string;
  preview: string;
  senderName: string;
  createdAt: string;
  readAt: string | null;
  attachmentCount: number;
  isReply: boolean;
  /** A forwarded message (labelled "Forwarded"). */
  forwarded: boolean;
}

/** One line of Sent. */
export interface SentItem {
  id: string;
  threadId: string;
  subject: string;
  preview: string;
  toAll: boolean;
  recipientCount: number;
  readCount: number;
  /** First few recipient names, for the "To" column. */
  recipientNames: string[];
  createdAt: string;
  withdrawnAt: string | null;
  attachmentCount: number;
  /** A forwarded message (labelled "Forwarded"). */
  forwarded: boolean;
}

/** A message as shown in a conversation. */
export interface MessageView {
  id: string;
  threadId: string;
  parentId: string | null;
  senderId: string;
  senderName: string;
  subject: string;
  /** Plain text. */
  body: string;
  /** The formatted message (sanitised HTML), or null for a plain-text message. */
  bodyHtml: string | null;
  toAll: boolean;
  /** A forwarded message (labelled "Forwarded"). */
  forwarded: boolean;
  createdAt: string;
  withdrawnAt: string | null;
  recipientCount: number;
  /** To: up to 50 names; recipientCount - ccCount is the full number. */
  recipientNames: string[];
  /** Cc: up to 50 names, and how many in all. */
  ccNames: string[];
  ccCount: number;
  attachments: AttachmentInfo[];
  /** This viewer sent it. */
  mine: boolean;
  /** This viewer may withdraw it now. */
  canWithdraw: boolean;
  /** Read by this many recipients (shown to the sender). */
  readCount: number;
}

export interface ThreadView {
  threadId: string;
  subject: string;
  messages: MessageView[];
  /** The message that was opened (highlighted). */
  openedId: string;
}

export interface DirectoryUser extends RecipientFacts {
  name: string;
  roleName: string;
  districtName: string | null;
  branchName: string | null;
}

/** Everything the "To" picker needs. */
export interface Directory {
  users: DirectoryUser[];
  roles: { code: string; name: string }[];
  districts: { id: string; name: string }[];
  branches: { id: string; name: string; districtId: string }[];
}
