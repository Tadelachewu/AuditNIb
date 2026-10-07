# Database Migrations

How the database schema is versioned, what was done on 2026-10-06 to restart the migration history, how to add a schema change from now on, and how to recover if the history gets out of step again.

---

## 1. Current state

| Folder in `prisma/migrations/` | What it is |
|---|---|
| `0_init` | **Baseline**: the whole database as it was on 2026-10-06, before Automatic Transfer. Marked as already applied on the existing database; on a brand-new database it creates every table |
| `20261006120000_auto_transfer_at_period_end` | Automatic transfer at period end: adds `auto_transfer_config` and `auto_transfer_runs`, marks periods that had already ended as handled, removes `settings.auto_transfer_on_lock` ([auto-transfer.md](auto-transfer.md)) |
| `20261006213000_auto_transfer_run_trigger` | Records what started each sweep (`triggered_by`: scheduler / in-app) |

Every new schema change is added on top of these as a new folder. **Keep this folder in git**; never delete it.

> **2026-10-06:** the folder was still **untracked** (never committed), and the `migration.sql` files of `0_init` and the auto-transfer migration were deleted from disk. They were regenerated from the schema in commits `6c80075` (before Automatic Transfer) and `dc10f8c` (after it), plus the data lines, and `migrate status` reports the database up to date. **Commit `prisma/migrations/` now** so this can't happen again.

## 2. What happened, and why the history was restarted

- The original migration files (24 of them, `20260910145739_init` … `20261003090000_remove_ui_template`) were deleted from the repository, but the database still listed them as applied in its `_prisma_migrations` table.
- Prisma then saw the whole database as "drift" (tables with no migration that created them). `npx prisma migrate dev` refused to continue unless the database was **reset**, which would have deleted every record.
- Instead, the history was restarted **without touching any data**:
  1. clear the old history records (history only, not data);
  2. record the current database as the new starting point, `0_init`, marked as applied;
  3. add the Automatic Transfer change as a normal migration and apply it with `migrate deploy`.

## 3. The steps that were run (PowerShell)

```powershell
# 1. Forget the old migration history (history only - no data is touched)
'DELETE FROM "_prisma_migrations";' | npx prisma db execute --stdin

# 2. Record the current database as the starting point
New-Item -ItemType Directory -Force prisma/migrations/0_init | Out-Null
npx prisma migrate diff --from-empty --to-config-datasource --script -o prisma/migrations/0_init/migration.sql
npx prisma migrate resolve --applied 0_init

# 3. Create the Automatic Transfer migration from the schema
New-Item -ItemType Directory -Force prisma/migrations/20261006120000_auto_transfer_at_period_end | Out-Null
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script -o prisma/migrations/20261006120000_auto_transfer_at_period_end/migration.sql
```

4. Data lines added by hand at the end of that `migration.sql` (Prisma only generates schema):

```sql
INSERT INTO "auto_transfer_config" ("id") VALUES ('singleton');

INSERT INTO "auto_transfer_runs" ("period_id", "status", "ran_at")
SELECT "id", 'SKIPPED_AT_RELEASE', CURRENT_TIMESTAMP
FROM "reporting_periods"
WHERE GREATEST("ends_at", "submission_ends_at") <= CURRENT_TIMESTAMP;
```

5. Apply, check, restart:

```powershell
npx prisma migrate deploy
npx prisma migrate status        # "Database schema is up to date!"
# then restart npm run dev
```

## 4. Other databases (test, production, a colleague's copy)

The new history must be adopted on **every** existing database once, otherwise `migrate deploy` there would try to create tables that already exist.

**An existing database that already has every table** (it was built by the old migrations):

```powershell
'DELETE FROM "_prisma_migrations";' | npx prisma db execute --stdin
npx prisma migrate resolve --applied 0_init
npx prisma migrate deploy        # applies only 20261006120000_auto_transfer_at_period_end
```

Take a backup (`pg_dump`) first, and check that the database's schema matched `0_init` before the change: `npx prisma migrate diff --from-migrations prisma/migrations --to-config-datasource` should show only the Automatic Transfer difference.

**A brand-new, empty database:**

```powershell
npx prisma migrate deploy        # 0_init builds everything, then the Automatic Transfer migration
npm run db:seed                  # demo data, development only
```

## 5. Adding a schema change from now on

1. Edit `prisma/schema.prisma`.
2. Create the migration:
   - **Development:** `npx prisma migrate dev --name short_description`. This now works normally, because the history matches the files. It creates the folder, applies it, and regenerates the client.
   - **Without applying yet:** generate the SQL with `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script -o prisma/migrations/<timestamp>_<name>/migration.sql`, then `npx prisma migrate deploy`.
3. Add any **data** changes (default rows, back-fills) to that `migration.sql` by hand.
4. Run `npx prisma generate` if the client wasn't regenerated, then restart the dev server.
5. **Commit the migration folder** together with the schema and code that use it.
6. On every other database: `npx prisma migrate deploy`.

## 6. Rules

| Do | Don't |
|---|---|
| `npx prisma migrate deploy` on any database with real data | `npx prisma migrate reset`: deletes all data |
| Keep and commit `prisma/migrations/` | Delete or rename migration folders that have been applied anywhere |
| Back up before applying a migration in production | `npx prisma db push` on a shared or production database: it skips the history |
| `npx prisma migrate status` to see what's pending | Answer "yes" when Prisma offers to reset a database with real data |

`migrate dev` is fine on your own development database, **as long as it doesn't ask to reset**. If it does, stop and read §7.

## 7. If Prisma reports "drift" or asks to reset again

That message means the files in `prisma/migrations/` and the `_prisma_migrations` table no longer agree, usually because folders were deleted or changed. **Your data is safe as long as you don't confirm a reset.**

1. Check `git status` / `git log -- prisma/migrations` and restore deleted folders if possible: `git checkout -- prisma/migrations`.
2. If they can't be restored, restart the history as in §3: clear the history records, baseline the current database as a new `0_init` (or a new dated baseline), mark it applied, and add pending changes as new migrations.

## 8. Reference

- Prisma config (migrations path, database URL): `prisma.config.ts`
- Schema: `prisma/schema.prisma`; generated client: `src/generated/prisma` (`npx prisma generate`)
- Production procedure: [PRODUCTION.md](PRODUCTION.md)
- Automatic transfer installation: [auto-transfer.md](auto-transfer.md) §5
