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
| **To** (top left) | **Everyone**, or **Choose**: four tabs - **Roles**, **Districts**, **Branches**, **People** - each a tick list with a count per item, a filter box and *Select all (shown)*. Ticks within a tab add up; **tabs narrow each other**: ticked roles *in* the ticked districts / branches (Branch Manager + Addis = Addis's branch managers, not every manager plus all of Addis). The Branches tab lists the ticked districts' branches; ticking a branch sends to that branch only, not its whole district. In **People**, ticked = receives it: untick someone to leave them out, tick anyone to add them. The selection shows under the tabs (× removes); **→ N people** opens the list of names by branch. The server applies the same rule (`selectionMatcher()` in `src/lib/communications/types.ts`), so the count is exactly who receives it |
| **Cc** (top right, next to To) | Optional: people who get a **copy**, picked the same way (no *Everyone*). They receive the message, the notification and the email like To recipients, and the message shows a separate **Cc:** line. Someone in both To and Cc counts once, as To. Not offered when To is *Everyone*. **Reply all** includes them. Stored as `communication_recipients.is_cc` (migration `20261023120000_communication_cc`) |
| **Subject** | Required, up to 200 characters |
| **Message** | Required, up to 10,000 characters of text. A formatting toolbar offers headings 1-6, font family, size, weight and line height, text and highlight colour, alignment, bold, italic, underline, strikethrough, sub- / superscript, lists, quotes, a dividing line and links (see *Formatting* below) |
| **Attach files** | Optional: **PDF, Word (.docx), Excel (.xlsx)**; up to **10 files, 25 MB in total** (all files together). The picker sits at the bottom right, under the message. Each file uploads as soon as you pick it; remove it with ✕ |

**Send** is enabled once someone is chosen, the subject and text are filled in, and every attachment has finished uploading. If something is missing, the reason shows next to the button.

Never included, whatever you pick: **administrators**, **inactive users** and **yourself**.

### Formatting

The message box is a rich text editor (Tiptap). Its toolbar offers exactly what a message can keep:

| Toolbar | Notes |
|---|---|
| Paragraph / **Heading 1-6** | Heading sizes for sections |
| **Font family** | Arial, Calibri, Cambria, Georgia, Segoe UI, Tahoma, Times New Roman, Trebuchet MS, Verdana, Courier New, and **Nyala** / **Ebrima** for Amharic. A reader without the font sees a similar one |
| **Font size** | 8 to 48 px |
| **Weight** | Light, Regular, Medium, Semibold, Bold, Extra bold, Black |
| **Line height** | 1, 1.15, 1.5, 2, 2.5 |
| Bold, italic, underline, strikethrough | Also with Ctrl+B / Ctrl+I / Ctrl+U |
| Subscript, superscript | e.g. H₂O, x² |
| **Text colour**, **highlight colour** | 18 swatches, or any colour from the picker |
| **Alignment** | Left, centre, right, justify (paragraphs and headings) |
| Bulleted list, numbered list, quote, dividing line | |
| Link | Select text, then the link button; web (`https://`) and email (`mailto:`) addresses only. Links always open in a new tab |
| Remove formatting, undo, redo | |

**Pasting** from Word or a web page keeps the same kinds of formatting (headings, fonts, sizes, colours, alignment ...) and drops the rest, such as tables, images, borders and spacing. Images and documents go in as **attachments**. The 10,000-character limit counts the text, not the formatting.

**Colours in dark mode:** a colour chosen for the text is kept as chosen, so very dark text can be hard to read for someone using dark mode (and very light text in light mode). Prefer mid-tone colours.

### Reading and replying

Opening a message shows the whole **conversation**: every message in it that you sent or received, oldest first, with the one you opened outlined. Opening it marks it read (and its bell notification).

| Button | Goes to |
|---|---|
| **Reply** | The sender |
| **Reply all** | The sender and everyone else on the message. Not offered for an **All users** message (it would message everyone again) |
| **Follow up to the recipients** | On your own message: its recipients. For an All users message, send a new message instead |

A reply's subject is **Re: …** automatically. Replies can have attachments too.

### Forward

**Forward** (on every message you can read: one you sent, or one you received that isn't withdrawn) opens the New message form with:
- **Subject:** the **same subject** as the original.
- **Message:** the **original message itself**, formatting kept. Edit it or add your own text.
- **Attachments:** the original's files **copied** as your own attachments. Remove any with ✕; removing one never touches the original.

Choose **To / Cc** and send. All the usual checks apply: recipients, 10 files, 25 MB in total, length rules. Server: `forwardDraft()` (`POST /api/communications/[id]/forward`).

**The "Forwarded" label.** A forward is labelled **Forwarded** on both sides: in the recipient's **Inbox** and the forwarder's **Sent** (before the subject), and in the conversation (next to the sender's name). The recipient's bell notification reads *"<name> forwarded: <subject>"*. The label comes from what's stored when the message is sent (`communications.forwarded_from_id`, migration `20261025120000_communication_forwarded`), so it stays even if the forwarder edits the text. The server only accepts a message the sender may read as the forwarded one (otherwise 404), and the audit log's `COMMUNICATION_SENT` entry records `forwardedFromId`. Before the migration is applied, a forward is sent without the label.

### Drafts

The New message form saves what you've written **as you type**: subject, To / Cc, the formatted text and the attached files, kept **24 hours** (Redis, like Register Finding's draft). After a refresh, a closed tab or a lost connection it's **restored**, with a banner and **Discard**. It's cleared once the message is sent. A forward starts from the forwarded message instead of a draft. If Redis is down, nothing is saved, and writing still works. Server: `/api/communications/draft` (GET / PATCH / DELETE, your own draft only).

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

The email is sent **formatted** (as in the app), with a plain-text version for mail programs that show text only. The server keeps only the formatting listed under *Formatting*; anything else a message might contain (scripts, styles, images, unsafe links) is removed before it is saved, shown or emailed.

**Switching email off:** Settings → **Email Events** → group **Communications** → **New message** / **Reply**. The bell notification is never affected.

An All users message to, say, 1,500 people queues 1,500 emails; the queue's rate limit spreads them out, and the sender doesn't wait for them.

---

## 3. Limits

| What | Limit |
|---|---|
| Subject / text | at least 3 characters each; at most 200 / 10,000 characters. **Spaces and line breaks never count.** The counter under the editor uses the server's own rule (`src/lib/communications/plainText.ts`), so the number shown is exactly the number checked |
| Attachments | 10 per message, 25 MB in total (checked on the server when sending), PDF / .docx / .xlsx only. Checked **on the server**, whatever the browser checked: the real content must match the type (a renamed file is refused), the name's extension must match the type (a PDF can't be called `.exe`), and Word / Excel files must be sane archives (no "zip bombs") **without macros** ([uploadChecks.ts](../src/lib/uploadChecks.ts)) |
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

1. `npx prisma migrate deploy` - applies `20261016120000_communications` (the three tables, and **Communications › View / Send for every role except ADMIN**) and `20261019120000_communication_rich_text` (the formatted message, `body_html`).
2. `npx prisma generate` (or `npm install`), rebuild, restart. Stop `npm run dev` before `prisma generate`.
3. Optional: Settings → Email Events → Communications, to choose which events are emailed.

---

## 6. How it's built (developers)

| Part | File |
|---|---|
| Types, limits (client-safe) | `src/lib/communications/types.ts` |
| Rules (pure): who may use it, recipients, replies, withdrawal, attachment check, email text | `src/lib/communications/rules.ts` |
| Formatted messages: sanitising, plain-text copy, email HTML (server only, `sanitize-html`) | `src/lib/communications/richText.ts` |
| Editor (Tiptap 3 + mui-tiptap toolbar) | `src/components/communications/RichMessageEditor.tsx` |
| Workflow: send, lists, conversation, withdraw, remove, attachments, directory | `src/lib/communications/service.ts` |
| API | `GET/POST /api/communications`, `GET/DELETE /api/communications/[id]`, `POST /api/communications/[id]/withdraw`, `POST /api/communications/attachments`, `GET/DELETE /api/communications/attachments/[attachmentId]`, `GET /api/communications/unread-count`, `GET /api/communications/directory` |
| Pages | `src/app/(app)/communications/` (list, `new`, `[id]`) |
| Components | `src/components/communications/` (list, compose, conversation, attachment picker, sidebar badge) |
| Tests | `tests/communications.test.ts`, `tests/communicationsRichText.test.ts`, `tests/richMessageEditor.test.tsx` |

**Data:** tables `communications` (one per message: thread, parent, sender, subject, body, to-all, withdrawn), `communication_recipients` (one per recipient: read, removed) and `communication_attachments` (one per file; `communication_id` empty until the message is sent). Names are snapshotted; there's no foreign key to users.

**Not in `readDb()`:** messages grow fast, so the module queries its own tables with Prisma instead of joining the app's in-memory `Database`. Sending goes through `updateDb()` only for the notifications, emails and audit entry, with the message rows written in the **same transaction** (`alsoWrite`), so a message is never saved without its notifications or the other way round.

**Attachments are uploaded one per request** before sending: ten 25 MB files can't travel in one request. The upload address is the one request allowed up to 26 MB (`src/proxy.ts`; everything else stays at 11 MB), and `next.config.ts` must allow the same (`experimental.proxyClientMaxBodySize: "26mb"`). Sending then links the uploaded files to the message.

**Email:** `notifyUsers()` takes an optional `emailMessage` (the full text) and `emailHtml` (the sanitised formatted body), so the bell shows a preview while the email carries the whole message, formatted, with a plain-text part. `notificationPath()` maps entity *Communication* to `/communications/<id>`.

**Formatted messages:** the editor sends HTML; the server never trusts it. `sanitizeMessageHtml()` keeps only `p, br, strong, em, u, s, sub, sup, span, mark, h1-h6, ul, ol, li, blockquote, hr, a`; styles only on `span` / `mark` (colour, background colour, font family, font size up to 72px / 54pt, font weight 100-900, line height) and on paragraphs / headings (text alignment, line height), each value checked against a pattern (colours as `#hex` / `rgb()` only; font names as letters, digits, spaces, quotes, commas and hyphens, so no `url()` or expressions). On links only `http(s):` / `mailto:` addresses, always with `target="_blank" rel="noopener noreferrer nofollow"`. A link with any other address keeps its text and loses the link. The plain text (`body`: search, previews, the limit, the plain-text email) is derived from the sanitised HTML (`body_html`), and the HTML is sanitised again whenever a conversation is returned. Messages without formatting keep `body_html` empty and show as plain text.

**Packages:** `@tiptap/*` 3.31.4 (MIT; including text-style, highlight, text-align, subscript, superscript; font weight is a small extension of its own, `src/components/communications/fontWeight.ts`), `mui-tiptap` 1.31.0 (MIT, the toolbar in Material UI), `sanitize-html` 2.18.0 (MIT). Tests use mui-tiptap's ES-module build (`vitest.config.mts`), like the app's webpack build, so only one copy of ProseMirror is loaded.

---

## 7. Test cases

**Automated:** `tests/communications.test.ts` covers who may use it (administrators excluded), recipient expansion (all users, people, roles, districts with their branches, branches; roles narrowed to the ticked places, a ticked branch refining its district, people added and excluded; admins, inactive users and the sender left out); `tests/recipientPicker.test.tsx` covers the To picker (tabs, linked branch list, live count, People untick / add, Select all, the reach list), replies and Reply all, "Re:" subjects, subject and text limits, attachment type / content / size checks, withdrawal rules, and the email (full text, attachment names, link, HTML-escaped text, the Email Events switch).

**Manual (UAT)**

| # | Steps | Expected | Result |
|---|---|---|---|
| C1 | Sign in as an administrator | No Communications in the sidebar; `/communications` goes to the dashboard | |
| C2 | Sign in as a Branch Controller | Communications in the sidebar, Inbox empty | |
| C2a | New message: use Heading 1 and 4, a font, a size, Semibold, a text colour, a highlight, centre alignment, a list and a link; paste a paragraph from Word | Toolbar works; the message shows all of it; pasted text keeps fonts, sizes, colours and alignment but no tables or images | |
| C3 | New message → add one person, subject, text, a PDF → Send | "Message sent" with 1 recipient; the message opens; Sent shows Read 0/1 | |
| C4 | Sign in as that recipient | Sidebar shows 1; bell shows "*Sender*: *Subject*"; Inbox row bold | |
| C5 | Check the recipient's mailbox | Formatted email with the whole text, the attachment name and a link; no file attached | |
| C5a | Open the message in the app | Shows the same formatting; the link opens in a new tab | |
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
