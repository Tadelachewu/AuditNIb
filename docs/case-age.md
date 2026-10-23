# Case Age

How long a finding has been open, in **whole days**. Every finding shows up to three ages, each counted from a different moment, up to **today**. With the test clock on (`APP_TEST_NOW`, docs/test-clock.md), "today" is the simulated date.

| Age | Counts from | Before that moment |
|---|---|---|
| **Case age (submit)** | The **first** time the finding was submitted. A draft never counts | "—" while it is still a draft |
| **Case age (approved)** | The **first** time it reached *Sent to Branch Manager*, i.e. **final approval**. That's HO approval, bank-wide approval, or the submit itself when no approval step applies | "—" while it is in review, returned or rejected |
| **Case age (finding date)** | The **Finding date** on the form (00:00 that day) | "—" if the Finding date is blank |

## Imported findings

An import submits and approves the finding in the same moment, so an imported finding shows **one** age for both:

- **Case age (submit / approved):** from the **time of the import**.
- **Case age (finding date):** from its Finding date. For a historical import, this is its real age.

## Rules

- **Transfers never reset an age.** A finding moved to another period keeps counting from its original moments.
- **Returned and resubmitted:** submit age still counts from the **first** submission.
- **Reversed, or transferred back:** approved age still counts from the **first** approval.
- **Closed findings stop ageing** at their **close date**. If a closed finding is reopened, it counts again from the same start.
- **Never negative.** A Finding date in the future (a typo) shows 0.
- **Older data:** a finding whose history has no submission on record, but which is past draft, counts submit and approved from its registration date. These ages are marked **(est.)**.

## Where it shows

| Place | What |
|---|---|
| **Finding page** | Case age (submit), Case age (approved), Case age (finding date). An import shows *Case age (submit / approved)* and *Case age (finding date)* |
| **Finding page: Transfer card and transfer history** | All ages, now and **at each transfer** |
| **Findings list** | Optional columns *Case Age (submit / approved / finding date)* in **Show/hide columns** (hidden at first), sortable, and in the CSV export |
| **Reports page: Transfers** | *Age at Transfer: Submit / Approved / Finding Date*, on screen and in the CSV |
| **Transferred Findings report** | *Case Age at Transfer* and *Case Age Today*, each as all three ages. The CSV has a column per age |
| **Dashboards: Avg. Backlog Age** (all four dashboards, right after *Outstanding Amount*) | The average **Case age (approved)** of **exactly the findings the *Outstanding* card counts**: the selected period and every filter (district, branch, source, category, risk, status, operation area, irregularity, date range). "--" when no period is in scope or nothing is outstanding |

## How it works

`src/lib/caseAge.ts` reads each finding's own history (`finding_transitions`):
- **submit:** the first `SUBMIT` / `IMPORT_SUBMIT`;
- **approved:** the first transition to `SENT_TO_BRANCH_MANAGER`;
- **close:** the latest transition to `CLOSED`, while the finding is closed.

The Finding date comes from the finding itself.

**"At a transfer"** means the same ages computed as of the transfer's time, so they're right for every transfer, old or new. Each transfer record also keeps the approved age at that moment (`caseAgeAtTransferDays`). It's used only when the finding no longer exists.

**No database change was needed.**
