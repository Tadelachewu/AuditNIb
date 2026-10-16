# Communications

Messages between colleagues across the bank: to **all users** or to **selected users**, with optional **PDF, Word or Excel** attachments. Every recipient is notified in the app (the bell and an unread count on the sidebar) and **by email**, with the whole message text.

**Administrators are excluded:** they don't see Communications, can't send messages and never receive them.

---

## 1. Using it

Open **Communications** in the sidebar (under My Profile and Support). The number on it is your unread messages.

### Inbox and Sent

| Tab | Shows |
|---|---|
| **Inbox** | Messages sent to you, newest first. Unread ones are bold with a blue dot. A paper clip means attachments |
| **Sent** | Messages you sent, with **Read N/M** (how many of the M recipients have opened it), or **Withdrawn** |

**Search** finds messages by subject, sender or text. The lists refresh by themselves every 30 seconds.

### Sending a message

**New message** → fill in:

| Field | Rule |
|---|---|
| **To** | Tick **All users**, or search and add any mix of **people**, **roles** (e.g. Branch Manager), **districts** and **branches**. A role, district or branch reaches all its active users; a district includes its branches. The line under the field says how many people it reaches |
| **Subject** | Required, up to 200 characters |
| **Message** | Required, plain text, up to 5,000 characters |
| **Attach files** | Optional: **PDF, Word (.docx), Excel (.xlsx)**; up to **5 files, 10 MB each**. Each file uploads as soon as you pick it; remove it with ✕ |

**Send** is enabled once someone is chosen, the subject and text are filled in, and every attachment has finished uploading. If something is missing, the reason shows next to the button.

Never included, whatever you pick: **administrators**, **inactive users** and **yourself**.

### Reading and replying

Opening a message shows the whole **conversation**: every message in it that you sent or received, oldest first, with the one you opened outlined. Opening it marks it read (and its bell notification).

| Button | Goes to |
|---|---|
| **Reply** | The sender |
| **Reply all** | The sender and everyone else on the message. Not offered for an **All users** message (it would message everyone again) |
| **Follow up to the recipients** | On your own message: its recipients. For an All users message, send a new message instead |

A reply's subject is **Re: …** automatically. Replies can have attachments too.

### Attachments

Click a file to download it. Only the **sender** and the **recipients** of that message can download it; every download is recorded in the Audit Log.

### Withdraw and remove

| Action | Who | When | Effect |
|---|---|---|---|
| **Withdraw** | The sender | Within **10 minutes** of sending, while **nobody has opened it** | It disappears from every recipient's Inbox, its bell notifications are removed and emails not yet sent are cancelled. Sent shows **Withdrawn** |
| **Remove from my inbox** | A recipient | Any time | Only your copy disappears; nobody else's changes |

An email that has already left can't be taken back.

---

## 2. Notifications and email

Each recipient gets:

- **A bell notification**: "*Sender*: *Subject*" (for a reply: "*Sender* replied: *Subject*") with the first 300 characters of the text. Clicking it opens the conversation.
- **An email**, through the email queue (retried if the mail server is down, [email-queue.md](email-queue.md)):
  - **Subject:** the same as the bell notification
  - **Body:** *From: sender*, the **whole message text**, the **names** of any attachments, and an **Open in NIB Control360** link to the message
  - **No files are attached to the email.** Attachments stay in the app, behind its access control

Typed text is sent as plain text; nothing in it becomes a link or formatting in the email.

**Switching email off:** Settings → **Email Events** → group **Communications** → **New message** / **Reply**. The bell notification is never affected.

An All users message to, say, 1,500 people queues 1,500 emails; the queue's rate limit spreads them out, and the sender doesn't wait for them.

---

## 3. Limits

| What | Limit |
|---|---|
| Subject / text | 200 / 5,000 characters |
| Attachments | 5 per message, 10 MB each, PDF / .docx / .xlsx only. The file's real content is checked, not just its name (a renamed file is refused) |
| Messages sent | 20 per user per 10 minutes |
| **All users** messages | 3 per user per hour |
| Uploads | 30 files per user per 10 minutes |
| Unsent uploads | An attachment uploaded but never sent is deleted after a day |

Older Word / Excel formats (.doc, .xls) and other file types aren't accepted: save as .docx / .xlsx or PDF first.

---

## 4. For administrators

| Topic | Detail |
|---|---|
| **Permissions** | Roles & Permissions → page **Communications**: **View** (read messages sent to you) and **Send** (new messages and replies). The install gives both to **every role except Administrator**. Take **Send** away to make a role read-only, or both to hide Communications |
| **Administrators** | Excluded whatever their role holds: no menu item, no sending, never a recipient, and the server refuses them on every Communications page and file |
| **Audit Log** | `COMMUNICATION_SENT`, `COMMUNICATION_REPLIED`, `COMMUNICATION_WITHDRAWN`, `COMMUNICATION_ATTACHMENT_DOWNLOAD` (entity *Communication*). Message contents are not readable by administrators in the app |
| **Email** | Settings → Email Events → Communications. Delivery and failures: Settings → Email Queue |
| **Storage** | Attachments are stored encrypted in `storage/communications/` ([files.md](files.md)). They are part of the storage backup ([backup-and-restore.md](backup-and-restore.md)) |
| **Dev Reset** | Doesn't touch messages (like Support conversations, they aren't finding data) |
| **New users** | Receive messages sent after their account exists; an earlier All users message isn't delivered to them |

---

## 5. Install

1. `npx prisma migrate deploy` - applies `20261016120000_communications`: the three tables, and **Communications › View / Send for every role except ADMIN**.
2. `npx prisma generate` (or `npm install`), rebuild, restart. Stop `npm run dev` before `prisma generate`.
3. Optional: Settings → Email Events → Communications, to choose which events are emailed.

---

## 6. How it's built (developers)

| Part | File |
|---|---|
| Types, limits (client-safe) | `src/lib/communications/types.ts` |
| Rules (pure): who may use it, recipients, replies, withdrawal, attachment check, email text | `src/lib/communications/rules.ts` |
| Workflow: send, lists, conversation, withdraw, remove, attachments, directory | `src/lib/communications/service.ts` |
| API | `GET/POST /api/communications`, `GET/DELETE /api/communications/[id]`, `POST /api/communications/[id]/withdraw`, `POST /api/communications/attachments`, `GET/DELETE /api/communications/attachments/[attachmentId]`, `GET /api/communications/unread-count`, `GET /api/communications/directory` |
| Pages | `src/app/(app)/communications/` (list, `new`, `[id]`) |
| Components | `src/components/communications/` (list, compose, conversation, attachment picker, sidebar badge) |
| Tests | `tests/communications.test.ts` |

**Data:** tables `communications` (one per message: thread, parent, sender, subject, body, to-all, withdrawn), `communication_recipients` (one per recipient: read, removed) and `communication_attachments` (one per file; `communication_id` empty until the message is sent). Names are snapshotted; there's no foreign key to users.

**Not in `readDb()`:** messages grow fast, so the module queries its own tables with Prisma instead of joining the app's in-memory `Database`. Sending goes through `updateDb()` only for the notifications, emails and audit entry, with the message rows written in the **same transaction** (`alsoWrite`), so a message is never saved without its notifications or the other way round.

**Attachments are uploaded one per request** before sending: the app's request size limit is about 10 MB, so five 10 MB files can't travel in one request. Sending then links the uploaded files to the message.

**Email:** `notifyUsers()` takes an optional `emailMessage`, so the bell shows a preview while the email carries the full text. `notificationPath()` maps entity *Communication* to `/communications/<id>`.

---

## 7. Test cases

**Automated:** `tests/communications.test.ts` covers who may use it (administrators excluded), recipient expansion (all users, people, roles, districts with their branches, branches; admins, inactive users and the sender left out), replies and Reply all, "Re:" subjects, subject and text limits, attachment type / content / size checks, withdrawal rules, and the email (full text, attachment names, link, HTML-escaped text, the Email Events switch).

**Manual (UAT)**

| # | Steps | Expected | Result |
|---|---|---|---|
| C1 | Sign in as an administrator | No Communications in the sidebar; `/communications` goes to the dashboard | |
| C2 | Sign in as a Branch Controller | Communications in the sidebar, Inbox empty | |
| C3 | New message → add one person, subject, text, a PDF → Send | "Message sent" with 1 recipient; the message opens; Sent shows Read 0/1 | |
| C4 | Sign in as that recipient | Sidebar shows 1; bell shows "*Sender*: *Subject*"; Inbox row bold | |
| C5 | Check the recipient's mailbox | Email with the whole text, the attachment name and a link; no file attached | |
| C6 | Open the message, download the PDF | Opens correctly; sidebar count goes to 0; sender's Sent shows Read 1/1 | |
| C7 | Reply | Sender gets a "replied" notification and email; the conversation shows both messages | |
| C8 | Send to a **district** | Reaches the district office and every branch's users in it (count shown before sending) | |
| C9 | Send to **All users** | Reaches every active non-admin user; no administrator gets anything | |
| C10 | On an All users message, try Reply all | Not offered; Reply goes to the sender | |
| C11 | Attach a .png, a renamed .exe as .pdf, a 12 MB PDF, a 6th file | Each refused with its reason | |
| C12 | As a user who isn't a recipient, open the message's address or its file's address | "Message not found" / "Attachment not found" | |
| C13 | Send, then Withdraw within 10 minutes before it's opened | Gone from the recipient's Inbox and bell; Sent shows Withdrawn | |
| C14 | Try Withdraw after the recipient opened it | Refused: someone has already opened it | |
| C15 | Remove from my inbox | Gone from your Inbox only; the sender's Sent unchanged | |
| C16 | Settings → Email Events → Communications → New message off; send | Bell notification only, no email | |
| C17 | Roles & Permissions: remove Send from a role | Its users can read but see no New message / Reply | |
| C18 | Audit Log | Entries for sent, replied, withdrawn and downloaded | |
