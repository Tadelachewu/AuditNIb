/**
 * Communications (docs/communications.md) - messages between users, to all
 * users or selected users, with optional PDF / Word / Excel attachments.
 * Administrators are excluded entirely (they can't send, receive or open
 * messages). Client-safe: types and constants only.
 */

export const COMMUNICATIONS_PAGE = "communications";

export const LIMITS = {
  subject: 200,
  body: 5000,
  /** Attachments per message. */
  attachments: 5,
  /** Bytes per attachment (one upload request each - see the attachments route). */
  attachmentBytes: 10 * 1024 * 1024,
  /** A sender can withdraw a message this long after sending it, while nobody has opened it. */
  withdrawMinutes: 10,
  /** Bell notification preview of the body (the email carries the whole text). */
  preview: 300,
} as const;

/** Allowed attachment types: PDF, Word (.docx), Excel (.xlsx). */
export const ATTACHMENT_TYPES: Record<string, { extension: string; label: string }> = {
  "application/pdf": { extension: "pdf", label: "PDF" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { extension: "docx", label: "Word" },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { extension: "xlsx", label: "Excel" },
};
export const ATTACHMENT_ACCEPT = ".pdf,.docx,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Who a new message goes to. Groups are expanded to their active, non-admin users when sent. */
export interface RecipientSelection {
  toAll: boolean;
  userIds: string[];
  roleCodes: string[];
  districtIds: string[];
  branchIds: string[];
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
}

/** A message as shown in a conversation. */
export interface MessageView {
  id: string;
  threadId: string;
  parentId: string | null;
  senderId: string;
  senderName: string;
  subject: string;
  body: string;
  toAll: boolean;
  createdAt: string;
  withdrawnAt: string | null;
  recipientCount: number;
  /** Up to 50 names; recipientCount is the full number. */
  recipientNames: string[];
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

export interface DirectoryUser {
  id: string;
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
