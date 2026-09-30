# Permissions Clarified

What some of the less obvious permissions in **Admin → Roles & Permissions** actually allow, what happens when they're used, and who has them by default. Every action below is recorded in the **Audit Log**.

Common rules for all of them:
- A permission is the **ceiling**. The finding must also be in the user's **organisational scope** (branch / district / bank), and the other conditions listed below must hold.
- A permission change applies at the user's **next sign-in**. Deactivating a role signs its users out immediately.
- The **Administrator** receives these automatically when they're added, and can give them to any other role.

---

## 1. Return Rectification for Correction: which one to use

Sends a recorded rectification back to the branch: *"what you recorded as fixed isn't right, correct it"*. The finding goes to **Rectification Returned**. The branch corrects it and resubmits.

There are three permissions for this. **Give new roles the District or HO one; don't use Legacy.**

| Permission | Who it's for | When it's allowed |
|---|---|---|
| **District: Return Rectification for Correction** (`findings.district-return-rectification`) | District Internal Controller | Any time the finding is *Partially Rectified*, *Rectified* or *Transferred*, **before or after** district verification |
| **HO: Return Rectification for Correction (after District verification)** (`findings.ho-return-rectification`) | Head Office Internal Controller | Only **after the District Controller has verified** at least part of the rectification. HO steps in after District, never ahead of it |
| **Return Rectification for Correction (Legacy)** (`findings.return-rectification`) | Older roles only | Same as the District one: no HO gate. Kept so roles created before the split keep working |

Rules that apply to all three:
- **Separation of duties:** someone who already **verified or closed** part of this finding's rectification can't also return it. A different person with the permission can.
- **Just transferred:** a finding that was just carried into a new period can't be returned until the branch records **new** rectification there.
- The finding's reporting period must not be locked.
- **Effect:** status → *Rectification Returned*. The branch rectifiers are notified (and the district verifiers when HO returns it), with the reason.

**Default holders:** District Controller (District), HO Controller (HO), Administrator (all three). Because the Administrator holds **Legacy**, it isn't subject to the HO gate. Remove Legacy from the Administrator if that isn't wanted.

---

## 2. Reverse an Import (`findings.reverse-import`)

Undoes a whole Excel import, from **Findings → Import → Import History → Reverse**.

- **What it removes:** every finding the import created, and **everything recorded against them since**: workflow steps, rectifications, verifications, closures, transfers, itemized cases, comments and evidence files. It works whatever has happened to the findings.
- **Before confirming** you see how many findings will be removed and **which ones have been worked on since the import**. That work is deleted too, so you must tick a confirmation. A reason is always required.
- **Two choices:**
  - **Reverse import:** the import stays in the history marked *Reversed* (who, when, why). It can later be **re-imported** from its stored file (Re-import also needs *Bulk Import*). Re-import runs every check again.
  - **Reverse and delete record:** the import is removed from the history as well.
- **What's kept:** the audit log keeps the full record, including the list of removed references and which findings had later work. Removed reference numbers are **never given to another finding**.
- **Scope:** every finding in the import must be within your organisational scope.
- **Default holder:** Administrator.

---

## 3. Delete Any Evidence (`findings.delete-evidence`)

Removes an uploaded evidence file (or an older comment attachment).

| Who | Can remove | When |
|---|---|---|
| The uploader (with *Upload Evidence*, or *Comment* for a comment attachment) | **only their own** files | while the finding is **not closed** |
| Holders of **Delete Any Evidence** | **anyone's** files | at **any** status, including closed. For housekeeping, e.g. a wrong or sensitive file |

- **Effect:** the file record is removed and the encrypted file is **deleted from storage**. It can't be recovered from the app.
- **Recorded:** an `EVIDENCE_DELETE` audit entry with the finding, file name and who uploaded it.
- The finding must be in your scope.
- **Default holder:** Administrator.

---

## 4. Reopen Closed / Partially Closed Findings (`findings.reopen`)

Resets a **closed** or **partially closed** finding to a fresh **Sent to Branch Manager**, as if nothing had been rectified. Use it when a closure was a mistake or the issue came back.

- **Where:** the finding's page → **Reopen**. A confirmation with a required reason comes first.
- **What changes:**
  - status → *Sent to Branch Manager*
  - rectified, district-verified and closed cases and amounts → 0
  - the rectification and closure records are removed, so they **stop counting** in performance %, dashboards and reports
  - itemized cases go back to *Outstanding*
  - transfers are kept
- **What's kept:** the full workflow history plus a new *Reopen* step with the reason, and an audit entry with a snapshot of everything that was reset.
- **Who is told:** the branch's rectifiers and the registrant get a **Reopened** notification.
- **Conditions:** the finding is in your scope and its reporting period isn't locked.
- **Default holder:** Administrator.

Details: [reopen-findings.md](reopen-findings.md).

---

## 5. Activate / Deactivate (`<list>.toggle-status`)

Available on **Users, Districts, Branches, Departments, Sources, Classified Categories and Uncovered Branch Reasons**. It is separate from *Edit*: a role can switch records on/off without being able to change them, or the other way round. Reporting Periods use **Lock / Unlock**, Roles use **Roles & Permissions › Manage**, and Scoring Rules use **Activate**.

**Deactivate** means *stop using it from now on, keep its history*. It can always be undone with **Activate**.

| Record | Effect of deactivating |
|---|---|
| **User** | Can't sign in, is signed out on their next click, and gets no notifications or emails |
| **District / Branch** | No new findings or users can be assigned to it; existing ones keep working and it still appears in reports |
| **Department / Source / Category** | Can't be picked for new findings or users; existing findings keep it |
| **Uncovered Branch Reason** | Can't be picked for new notes; existing notes keep it |

**Safety limits (permission-based):**
- You **can't deactivate or delete your own account**.
- A change is refused if it would leave **nobody active** holding *Users › Activate / Deactivate* or *Roles & Permissions › Manage*, the two permissions needed to undo it. This covers deactivating or deleting a user, changing a user's role, and deactivating a role.

Details: [deactivation.md](deactivation.md).

---

## 6. Import duplicates (related setting, not a permission)

The Excel import checks duplicates with the **same rule as the Register Finding form**: the fields the administrator chose in **Settings → Similar Findings**.
- A row is a possible duplicate when every chosen field matches an existing finding.
- If any are found, nothing is imported until the importer chooses **Import anyway** (all rows, duplicates included and linked to what they matched) or **Cancel**.
- With no fields chosen, duplicates aren't checked.
