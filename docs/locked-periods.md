# What a Locked Period Blocks

A reporting period is locked from **Admin → Reporting Periods → Lock**. **A locked period blocks submission**, and **drafting** when its **Drafts blocked** setting is on. Every other action works the same as in an open period.

Each locked period shows **Drafts allowed** or **Drafts blocked** on Admin → Reporting Periods; it's chosen when locking and can be changed while the period stays locked. New periods start with drafts allowed.

## Open periods

In an **open** period drafting is **always allowed**: register a draft, save changes, delete it. The *Drafts allowed / blocked* setting only takes effect once the period is locked.

The one limit in an open period is the **submission window** (set per period on Admin → Reporting Periods): outside it, **Submit** / **Save & Submit** is disabled with a note to save as a draft instead, and the server refuses a submission. Drafts are never affected by the window.

| In an OPEN period | Window open | Window closed |
|---|---|---|
| Register / save / delete a draft (or a returned finding) | ✅ | ✅ |
| Submit | ✅ | ❌ (Submit hidden / disabled) |

Tests: `tests/openPeriodDrafts.test.ts`.

## Blocked (locked period)

| Action | What happens |
|---|---|
| **Submit** a draft or returned finding | Refused: "… is locked and cannot accept changes" (`PERIOD_LOCKED`) |
| **Register and submit** in one step | Refused; save it as a draft instead and submit once the period is open |
| **Drafting** (follows the period's **Drafts allowed / blocked** setting): register a new draft, **save changes to a draft or returned finding**, **delete a draft or returned finding**, move a finding into the period while editing it | **Drafts allowed:** works. **Drafts blocked:** refused ("… is locked and drafts are blocked for it …"), and the finding page hides **Edit** and **Delete** |

## Not affected

- **District review, HO review, bank-wide approval:** approve, return, reject
- **Rectification:** record, resubmit, return for correction, verify
- **Close** (full or partial)
- **Transfer** out of or into a locked period, earlier or later
- **Reverse** a closed / partially closed finding
- **Delete** a rejected finding (housekeeping)
- **Comments and evidence**
- **Excel import**, including a TRANSFERRED row whose destination is locked

## Automatic transfer on lock

When a period is locked, the person locking it can choose to move its outstanding findings to the **next open period** (if Settings → Case Transfer allows it). This is optional, and findings left behind can still be worked on in the locked period.

## Where it's enforced

`assertPeriodWritable()` in `src/lib/findings.ts`, called by the submit route, the create route (create-and-submit and new drafts), and the edit / delete route for drafting (save or delete a draft or returned finding, move into another period). The finding page hides Submit in a locked period and Edit / Delete when drafts are blocked. Tests: `tests/lockedPeriod.test.ts`.
