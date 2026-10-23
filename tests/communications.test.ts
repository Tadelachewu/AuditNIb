import { describe, expect, it } from "vitest";
import {
  attachmentProblem,
  canSendCommunications,
  canUseCommunications,
  canWithdraw,
  emailText,
  messageProblem,
  previewOf,
  replyRecipients,
  replySubject,
  resolveRecipients,
  resolveToAndCc,
} from "@/lib/communications/rules";
import { emailForNotification, notificationPath } from "@/lib/emailQueue/rules";
import { LIMITS, selectionMatcher, type RecipientSelection } from "@/lib/communications/types";
import type { Database, Notification } from "@/types";
import { officeZip } from "./helpers/zip";

// Communications (docs/communications.md): who may use it, who a message
// reaches, replies, withdrawal, attachments and the email.

const user = (id: string, role: string, extra: Partial<Database["users"][number]> = {}) =>
  ({ id, name: id.toUpperCase(), role, status: "ACTIVE", email: `${id}@nib.test`, districtId: null, branchId: null, ...extra }) as Database["users"][number];
const users = [
  user("admin", "ADMIN"),
  user("ho", "HO_CONTROLLER"),
  user("dc", "DISTRICT_CONTROLLER", { districtId: "d1" }),
  user("bc", "BRANCH_CONTROLLER", { districtId: "d1", branchId: "b1" }),
  user("bm", "BRANCH_MANAGER", { districtId: "d1", branchId: "b1" }),
  user("bm2", "BRANCH_MANAGER", { districtId: "d2", branchId: "b2" }),
  user("gone", "BRANCH_MANAGER", { status: "INACTIVE", districtId: "d1", branchId: "b1" }),
];
const db = { users } as Pick<Database, "users">;
const none = { toAll: false, userIds: [], roleCodes: [], districtIds: [], branchIds: [] };
const ids = (r: { id: string }[] | { error: string }) => ("error" in r ? r : r.map((x) => x.id).sort());

describe("who may use Communications", () => {
  const perms = ["communications.view", "communications.send"];
  it("any role with the permissions, but never an administrator", () => {
    expect(canUseCommunications({ userId: "ho", role: "HO_CONTROLLER", permissions: perms })).toBe(true);
    expect(canSendCommunications({ userId: "ho", role: "HO_CONTROLLER", permissions: perms })).toBe(true);
    expect(canUseCommunications({ userId: "admin", role: "ADMIN", permissions: perms })).toBe(false);
    expect(canSendCommunications({ userId: "admin", role: "ADMIN", permissions: perms })).toBe(false);
  });
  it("View without Send: can read, can't send", () => {
    expect(canUseCommunications({ userId: "bm", role: "BRANCH_MANAGER", permissions: ["communications.view"] })).toBe(true);
    expect(canSendCommunications({ userId: "bm", role: "BRANCH_MANAGER", permissions: ["communications.view"] })).toBe(false);
  });
  it("no permission: nothing", () => {
    expect(canUseCommunications({ userId: "bm", role: "BRANCH_MANAGER", permissions: [] })).toBe(false);
  });
});

describe("who a new message reaches", () => {
  it("All users: every active non-admin user except the sender", () => {
    expect(ids(resolveRecipients(db, { ...none, toAll: true }, "ho"))).toEqual(["bc", "bm", "bm2", "dc"]);
  });
  it("selected people; an administrator or inactive user picked by id is skipped", () => {
    expect(ids(resolveRecipients(db, { ...none, userIds: ["bm", "admin", "gone"] }, "ho"))).toEqual(["bm"]);
  });
  it("a role, a district (its office and branches) and a branch expand to their users, without duplicates", () => {
    expect(ids(resolveRecipients(db, { ...none, roleCodes: ["BRANCH_MANAGER"] }, "ho"))).toEqual(["bm", "bm2"]);
    expect(ids(resolveRecipients(db, { ...none, districtIds: ["d1"] }, "ho"))).toEqual(["bc", "bm", "dc"]);
    expect(ids(resolveRecipients(db, { ...none, branchIds: ["b1"], userIds: ["bm"] }, "ho"))).toEqual(["bc", "bm"]);
  });
  it("never the sender, even when their own branch is picked", () => {
    expect(ids(resolveRecipients(db, { ...none, branchIds: ["b1"] }, "bc"))).toEqual(["bm"]);
  });
  it("the Administrator role can't be picked as a group", () => {
    expect(resolveRecipients(db, { ...none, roleCodes: ["ADMIN"] }, "ho")).toEqual([]);
  });
});

describe("ticks narrow across categories (the To picker)", () => {
  const withBranches = { ...db, branches: [{ id: "b1", districtId: "d1" }, { id: "b2", districtId: "d2" }, { id: "b3", districtId: "d1" }] } as unknown as Pick<Database, "users" | "branches">;
  const send = (sel: Partial<RecipientSelection>) => ids(resolveRecipients(withBranches, { ...none, ...sel }, "ho"));

  it("a role + a district = that role IN that district (not everyone in both)", () => {
    expect(send({ roleCodes: ["BRANCH_MANAGER"], districtIds: ["d1"] })).toEqual(["bm"]);
  });
  it("two roles add up, then narrow to the place", () => {
    expect(send({ roleCodes: ["BRANCH_MANAGER", "DISTRICT_CONTROLLER"], districtIds: ["d1"] })).toEqual(["bm", "dc"]);
  });
  it("a ticked branch refines its district: only that branch of it (other districts stay whole)", () => {
    expect(send({ districtIds: ["d1", "d2"], branchIds: ["b1"] })).toEqual(["bc", "bm", "bm2"]);
    expect(send({ districtIds: ["d1"], branchIds: ["b3"] })).toEqual([]);
  });
  it("a branch on its own, with a role", () => {
    expect(send({ roleCodes: ["BRANCH_CONTROLLER"], branchIds: ["b1"] })).toEqual(["bc"]);
  });
  it("people ticked one by one are always added; people unticked are left out", () => {
    expect(send({ roleCodes: ["BRANCH_MANAGER"], districtIds: ["d1"], userIds: ["bm2"] })).toEqual(["bm", "bm2"]);
    expect(send({ districtIds: ["d1"], excludedUserIds: ["bc"] })).toEqual(["bm", "dc"]);
  });
  it("the live count uses the very same rule as the server", () => {
    const sel = { ...none, roleCodes: ["BRANCH_MANAGER"], districtIds: ["d1"], excludedUserIds: [] };
    const districtOf = new Map([["b1", "d1"], ["b2", "d2"]]);
    const facts = users.filter((u) => u.status === "ACTIVE" && u.role !== "ADMIN" && u.id !== "ho").map((u) => ({ id: u.id, roleCode: u.role, districtId: u.districtId ?? null, branchId: u.branchId ?? null }));
    expect(facts.filter(selectionMatcher(sel, (id) => districtOf.get(id))).map((u) => u.id)).toEqual(send(sel));
  });
});

describe("replies", () => {
  const msg = { senderId: "ho", toAll: false, recipientIds: ["bc", "bm", "dc"] };
  it("Reply goes to the sender; Reply all to the sender and the other recipients", () => {
    expect(ids(replyRecipients(db, msg, "bc", false))).toEqual(["ho"]);
    expect(ids(replyRecipients(db, msg, "bc", true))).toEqual(["bm", "dc", "ho"]);
  });
  it("the sender following up their own message reaches its recipients", () => {
    expect(ids(replyRecipients(db, msg, "ho", false))).toEqual(["bc", "bm", "dc"]);
  });
  it("Reply all isn't available on an All users message; Reply still is", () => {
    const all = { senderId: "ho", toAll: true, recipientIds: ["bc", "bm", "bm2", "dc"] };
    expect(replyRecipients(db, all, "bc", true)).toEqual({ error: expect.stringContaining("Reply all") });
    expect(ids(replyRecipients(db, all, "bc", false))).toEqual(["ho"]);
  });
  it("people who can no longer receive messages are dropped", () => {
    expect(ids(replyRecipients(db, { senderId: "gone", toAll: false, recipientIds: ["bc"] }, "bc", false))).toEqual({ error: expect.any(String) });
  });
  it("Re: is added once", () => {
    expect(replySubject("Cash count")).toBe("Re: Cash count");
    expect(replySubject("Re: RE: Cash count")).toBe("Re: Cash count");
  });
});

describe("message and attachment checks", () => {
  it("subject and text are required and limited", () => {
    expect(messageProblem("", "Hi")).toMatch(/Subject/);
    expect(messageProblem("Hello", "  ")).toMatch(/text/);
    expect(messageProblem("x".repeat(201), "Hello")).toMatch(/200/);
    expect(messageProblem("Hello", "x".repeat(10001))).toMatch(/10000/);
    expect(messageProblem("Hello", "Hello")).toBeNull();
    // At least 3 characters each.
    expect(messageProblem("Hi", "Hello")).toMatch(/Subject must be at least 3/);
    expect(messageProblem("Hey", "ok")).toMatch(/text must be at least 3/);
    expect(messageProblem("Hey", "yes")).toBeNull();
  });
  const pdf = Buffer.from("%PDF-1.7\n...");
  const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const file = (name: string, type: string, content: Buffer) => attachmentProblem({ name, type, size: content.length }, content);
  it("PDF, Word and Excel files whose content and name match are accepted", () => {
    expect(file("plan.pdf", "application/pdf", pdf)).toBeNull();
    expect(file("plan.docx", DOCX, officeZip("docx"))).toBeNull();
    expect(file("figures.xlsx", XLSX, officeZip("xlsx"))).toBeNull();
  });
  it("other types, a disguised file, an empty or oversized file are refused", () => {
    expect(file("a.png", "image/png", Buffer.from([0x89, 0x50]))).toMatch(/Only PDF/);
    expect(file("a.pdf", "application/pdf", Buffer.from("<html>not a pdf</html>"))).toMatch(/content/);
    expect(attachmentProblem({ name: "a.pdf", type: "application/pdf", size: 0 }, Buffer.alloc(0))).toMatch(/empty/);
    // Up to 25 MB per file now; over it is refused.
    expect(attachmentProblem({ name: "a.pdf", type: "application/pdf", size: 11 * 1024 * 1024 }, pdf)).toBeNull();
    expect(attachmentProblem({ name: "a.pdf", type: "application/pdf", size: 26 * 1024 * 1024 }, pdf)).toMatch(/25 MB/);
  });
  it("a real PDF named like a program, a macro-enabled or zip-bomb Word / Excel file is refused", () => {
    expect(file("invoice.exe", "application/pdf", pdf)).toMatch(/\.pdf/);
    expect(file("plan.docx", DOCX, officeZip("docx", [{ name: "word/vbaProject.bin" }]))).toMatch(/macros/);
    expect(file("big.xlsx", XLSX, officeZip("xlsx", [{ name: "xl/s.xml", data: "x".repeat(1000), unpacked: 500 * 1024 * 1024 }]))).toMatch(/unpacks/);
  });
});

describe("withdrawal", () => {
  const sent = new Date("2026-10-16T10:00:00Z").getTime();
  const m = { senderId: "ho", createdAt: new Date(sent).toISOString(), withdrawnAt: null };
  it("the sender, within 10 minutes, while nobody has opened it", () => {
    expect(canWithdraw(m, "ho", 0, sent + 9 * 60_000)).toBe(true);
    expect(canWithdraw(m, "ho", 0, sent + 11 * 60_000)).toBe(false);
    expect(canWithdraw(m, "ho", 1, sent + 60_000)).toBe(false);
    expect(canWithdraw(m, "bc", 0, sent + 60_000)).toBe(false);
    expect(canWithdraw({ ...m, withdrawnAt: new Date(sent).toISOString() }, "ho", 0, sent + 60_000)).toBe(false);
  });
});

describe("the email", () => {
  const settings = { notification: { provider: "SMTP", smtpHost: "mail", smtpPort: 25, fromAddress: "noreply@nib.test", emailEvents: {} } } as unknown as Database["settings"];
  const env = { SMTP_USER: "u", SMTP_PASSWORD: "p", APP_BASE_URL: "https://control360.nib.test" };
  const body = "Line one\nLine two <b>not bold</b>";
  const notification: Notification = {
    id: "n1", recipientUserId: "bc", type: "COMMUNICATION", title: "HO: Cash count", message: emailText("HO", body, ["plan.pdf"]),
    entityType: "Communication", entityId: "m1", readAt: null, createdAt: "2026-10-16T10:00:00Z",
  } as Notification;

  it("carries the whole text, the attachment names and a link to the message - not the files", () => {
    const email = emailForNotification({ settings, users }, "bc", notification, env)!;
    expect(email.subject).toBe("HO: Cash count");
    expect(email.bodyText).toContain("From: HO");
    expect(email.bodyText).toContain("Line one\nLine two <b>not bold</b>");
    expect(email.bodyText).toContain("- plan.pdf");
    expect(email.bodyText).toContain("https://control360.nib.test/communications/m1");
    // Typed text never becomes HTML in the mailbox.
    expect(email.bodyHtml).toContain("&lt;b&gt;not bold&lt;/b&gt;");
    expect(notificationPath(notification)).toBe("/communications/m1");
  });
  it("is switched off by Settings -> Email Events -> Communications", () => {
    const off = { ...settings, notification: { ...settings.notification, emailEvents: { COMMUNICATION: false } } } as Database["settings"];
    expect(emailForNotification({ settings: off, users }, "bc", notification, env)).toBeNull();
  });
  it("the bell shows a short preview", () => {
    expect(previewOf("x".repeat(400)).length).toBe(300);
    expect(previewOf("a\n\n b")).toBe("a b");
  });
});

describe("To + Cc", () => {
  it("Cc'd people receive it too; someone in both is To only; the sender never", () => {
    const r = resolveToAndCc(db, { ...none, userIds: ["bm"] }, { ...none, userIds: ["bm", "bc", "ho"] }, "ho");
    expect(ids(r.recipients)).toEqual(["bc", "bm"]);
    expect(r.ccIds).toEqual(["bc"]);
  });
  it("Cc by group, narrowed like To", () => {
    const r = resolveToAndCc(db, { ...none, userIds: ["dc"] }, { ...none, roleCodes: ["BRANCH_MANAGER"], districtIds: ["d1"] }, "ho");
    expect(ids(r.recipients)).toEqual(["bm", "dc"]);
    expect(r.ccIds).toEqual(["bm"]);
  });
  it("no Cc with Everyone (everyone already receives it)", () => {
    const r = resolveToAndCc(db, { ...none, toAll: true }, { ...none, userIds: ["bm"] }, "ho");
    expect(r.ccIds).toEqual([]);
  });
  it("no Cc: just To", () => {
    expect(resolveToAndCc(db, { ...none, userIds: ["bm"] }, undefined, "ho")).toEqual({ recipients: [{ id: "bm", name: "BM" }], ccIds: [] });
  });
});

describe("limits", () => {
  it("message text up to 10,000 characters; up to 10 files of 25 MB each", () => {
    expect(LIMITS.body).toBe(10_000);
    expect(LIMITS.attachments).toBe(10);
    expect(LIMITS.attachmentBytes).toBe(25 * 1024 * 1024);
    expect(messageProblem("Subject", "x".repeat(10_000))).toBeNull();
    expect(messageProblem("Subject", "x".repeat(10_001))).not.toBeNull();
  });
});
