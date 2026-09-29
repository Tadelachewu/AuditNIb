# Reset Data (`/dev-reset`)

A tool that **permanently deletes every finding and everything created from findings**, leaving all configuration (users, roles, branches, settings, …) untouched. It exists so a **development, demo, training or UAT** database can go back to a clean slate between test rounds.

> ⚠️ **Never enable it on a server with real data.** A reset can't be undone.

---

## 1. When does it work?

It depends on **one setting only: `APP_ENV`** in the server's `.env`. It does **not** depend on whether the app runs with `npm run dev` or as a built app (`npm run build` + `npm start`).

| `APP_ENV` in `.env` | `npm run dev` | `npm run build` + `npm start` |
|---|---|---|
| `development` | ✅ **enabled** | ✅ **enabled** |
| `production` | ❌ disabled | ❌ disabled |
| **not set / empty** | ❌ disabled | ❌ disabled |
| anything else (`dev`, `staging`, `test`, …) | ❌ disabled | ❌ disabled |

- **The same switch hides the login page's "Demo accounts" panel.** Demo credentials are shown, and sent to the browser, only when `APP_ENV=development`. On production, seeding also marks every seeded account "must change password" ([PRODUCTION.md §5](PRODUCTION.md)).
- **Only the exact word `development` turns it on.** Upper/lower case and surrounding spaces don't matter.
- **Unset means off,** so a newly installed server can't be wiped by accident. You have to opt in deliberately.
- **`NODE_ENV` has no effect.** Next.js sets it on its own (`development` under `npm run dev`, `production` for any build), so it says nothing about whether a server's data is disposable. It used to control this tool, which meant a built UAT server could never reset and any dev server always could.
- **Changing `APP_ENV` only needs a restart** of the app, never a rebuild. The value is read when requests arrive, not baked into the build.

### Recommended values

| Server | `APP_ENV` |
|---|---|
| A developer's own machine | `development` |
| A demo / training / UAT server whose data is disposable | `development` |
| **Any server with real bank data** | **`production`** |

`.env.example` ships with `APP_ENV=production`, so a new install copied from it starts **safe**.

---

## 2. Turning it on or off

1. Open the server's `.env` and set the line:
   ```
   APP_ENV=development     # to enable
   APP_ENV=production      # to disable
   ```
2. **Restart the app** (stop and start `npm run dev`, or `npm start`).
3. Open `/dev-reset`. When it's disabled, the page says the tool is turned off on this server.

---

## 3. Who can use it and how

- **Only users with the Administrator role.** It checks the role itself, not a permission, because it's far more destructive than anything the permission system controls, so a custom role can't be granted it.
- **Not in the sidebar.** Go to the address directly: **`/dev-reset`**.
- The page first shows **how many records will be deleted** (findings, comments, evidence, …).
- To run it, type **`DELETE ALL FINDINGS`** exactly. The button stays disabled until the phrase matches.
- Afterwards it shows a summary of what was removed.

---

## 4. What a reset deletes and what it keeps

### Deleted

| What | Notes |
|---|---|
| **All findings** | Every status, every period |
| Workflow history | Transitions, rectifications, transfers, closures, itemised cases |
| **Comments** and **evidence / attachment records** | |
| **Uploaded files** | The stored evidence files **and** the stored original import spreadsheets are deleted from the storage folder (`storage/evidence/`, `storage/imports/`), not just their records. See [files.md](files.md). |
| **Import history** | Every import batch |
| Scoring adjustments | |
| Uncovered-branch coverage notes | |
| **Finding notifications** | Only notifications about findings. Support notifications stay. |
| **Finding audit log entries** | Only entries about findings. |

### Changed

| What | How |
|---|---|
| **Locked reporting periods** | Unlocked back to **Open** (lock reason and who/when cleared). The periods themselves are kept. |

### Kept, never touched

Users, roles and permissions, districts, branches, sources, departments, classified categories, uncovered-branch reasons, scoring rules, reporting periods (only unlocked), **Settings** (lists, notifications, appearance, …), and every audit log entry that isn't about a finding.

### Recorded

The reset writes one audit log entry, **`DEV_RESET_REGISTERED_DATA`**, with who ran it, when, and the full summary of what was removed. It stays in the log after the reset.

> The audit log is hash-chained. Removing the finding entries leaves gaps in that chain, which any integrity check would report as tampering. That's expected on a development or UAT server, and one more reason never to enable this where the audit trail matters.

---

## 5. Safety layers

| Layer | Effect |
|---|---|
| **`APP_ENV` must be `development`** | Otherwise the API answers **404 Not Found**, as if the tool didn't exist, whoever calls it and however. This is the check that matters. |
| **Administrator role only** | Anyone else gets 403, even with every permission. |
| **Confirmation phrase** | The request must include `DELETE ALL FINDINGS` exactly. |
| **Hidden** | Not linked in the sidebar or anywhere else in the app. |
| **Audit entry** | Every reset is recorded. |

---

## 6. Removing the feature entirely

If a production release should not contain the tool at all, delete these three files. Nothing else in the app refers to them:

- `src/lib/devResetRegisteredData.ts`
- `src/app/api/admin/dev-reset/route.ts`
- `src/app/(app)/dev-reset/page.tsx`

---

## 7. Existing installs

The switch changed from `NODE_ENV` to `APP_ENV`. On an install that relied on the old behaviour (reset available under `npm run dev`), add `APP_ENV=development` to its `.env` and restart. Without it the tool stays **off**. That's the safe default, but it means resets stop working there until the line is added.
