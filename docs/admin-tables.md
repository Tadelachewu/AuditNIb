# Tables: Search, Filter, Sort, Export and Import

Every list in the Administration area, plus the Findings list, the dashboards' tables and the Reports page tables (§3), is built on **[Material React Table](https://www.material-react-table.com/)** (MRT v3, on MUI 7), themed to the app: brand gold, the chosen font and text size, and light/dark mode following the app's own toggle.

All of them share one component, `AdminTable`, so they behave the same, and every list is **paged on the server**: the server searches, filters, sorts and pages, and the browser only receives the rows it shows.

---

## 1. What every table can do

| Feature | How |
|---|---|
| **Search** | The search box at the top left searches **all columns** at once (after a short typing pause). |
| **Column filters** | The filter icon (≡) in the toolbar shows a filter under each column heading: text, a dropdown (status, district, role…) listing every value in the **whole** list, or a min/max range for numbers. |
| **Sort** | Click a column heading; click again to reverse. |
| **Show/hide columns** | The columns icon in the toolbar. |
| **Density** | Compact, normal or comfortable rows. |
| **Full screen** | The expand icon. |
| **Paging** | 10 / 25 / 50 / 100 / **All** per page, with first/last buttons. Only the page shown is fetched. The page bar stays pinned to the bottom of the screen while you scroll. |
| **Row details** | The arrow at the start of each row opens its **detail panel**: every field of the row, label and value, two per line, including columns hidden with Show/hide columns. |
| **Row actions** | The **⋯** button in the last column opens the row's actions (Edit, Activate/Deactivate, Lock, Delete, …) as a Material menu. Delete is always last, below a divider. An action that isn't allowed for that row is greyed out with the reason under it. |
| **Loading** | Skeleton rows while data loads. |
| **Export CSV** | A menu with two choices. **Rows shown** exports every row matching the search, filters and sort (**all pages**, not only the current one). **Full table** exports every row, ignoring search and filters. Both are built by the server and open correctly in Excel, including Amharic text. |
| **Bulk actions** | When rows are ticked (Findings, Uncovered Branches), the bulk-action bar sticks just under the top bar while you scroll. |
| **Import CSV** | On the reference-data lists (§4). |
| **Print** | Toolbars and page bars are left out of printouts and Print-to-PDF; only the rows print. |

**Security of exports:** a cell that starts with `=`, `+`, `-` or `@` is written with a leading `'`, so a spreadsheet shows it as text instead of running it as a formula ("CSV injection").

---

## 2. Lists and their features

| List | Search / filter / sort | Export | Import | Notes |
|---|---|---|---|---|
| Users | ✅ (filters: role, org unit, department, status) | ✅ | ✅ | Import: `username`*, `name`*, `email`*, `phone`, `role`* (code), `district`, `branch`, `department` (code or name), `temporary_password`*. Each row goes through the normal create-user checks; the user must change the temporary password at first sign-in (it expires in 24 h). The password column is **never** written to the results file; delete the CSV after importing. Export never includes passwords. |
| Districts | ✅ (status) | ✅ | ✅ | |
| Branches | ✅ (district, status) | ✅ | ✅ | |
| Departments | ✅ (level, status) | ✅ | ✅ | |
| Classified Categories | ✅ (scored, status) | ✅ | ✅ | |
| Sources | ✅ (default, status) | ✅ | ✅ | |
| Uncovered Branch Reasons | ✅ (status) | ✅ | ✅ | |
| Reporting Periods | ✅ (status) | ✅ | ❌ | Newest period first. Periods have lock rules and date windows; create them one at a time. |
| Audit Log | ✅ (actor, action, entity, **date range**), sort by time | ✅ | ❌ | |
| Roles, Scoring Rules, Import History, Support | — | — | — | Card lists (not tables) with a Previous/Next page bar; one page is fetched at a time. |

---

## 3. Tables outside Administration

| Table | Where | Notes |
|---|---|---|
| **Findings list** | Findings | Search, sort, page and page size live in the address bar (`q`, `sort`, `dir`, `page`, `pageSize`), so a view can be shared and survives refresh. The FilterBar above does the filtering. **Export CSV** downloads every matching finding (`/api/findings/export`). Row checkboxes and bulk actions; clicking a row opens the finding. |
| **Findings Report** | Reports | Same as the Findings list, read-only. The page's **Download CSV** button also includes the search and sort. |
| **Branch / District Performance**, **Category / Risk Breakdown**, **Transfers** | Reports | Each table keeps its own page, search, filters and sort in the address bar under its own prefix (`branchPerf.`, `districtPerf.`, `categories.`, `risks.`, `transfers.`), so the tables on one page don't affect each other. |
| **Rankings, Category Totals, Source Comparison** | Dashboards | The same, with prefixes `branchRanking.`, `branchPerf.`, `districtRanking.`, `categoryTotals.`, `sources.`. Footer TOTALs add up **every** row, not just the page. Rank is always the official performance rank, whatever the sort. |
| **Uncovered Branches** | Report Templates | **No paging** and no detail panel: an official template that must print every branch at once, and each row is its own reason form. Search, sort, district filter and export; tick rows (or "select all" of what the search leaves) to apply one reason to many branches. |

**Left as they are:** the other report templates (fixed official layouts with their own Excel/PDF export), the small dashboard widgets (top-N cards), and the import guide and batch preview tables.

---

## 4. Importing from CSV

1. Click **Import CSV** in the table's toolbar. You need the list's **Create** permission.
2. **Download template.** Keep the header row exactly as it is and add one record per row.
3. Choose your filled-in file (up to 1,000 rows, 2 MB). It checks that the required columns are there and says how many rows it found.
4. **Import.** Each row is sent to the **same create API as the Add form**, one at a time with a progress bar. So every existing rule applies unchanged: required fields, unique codes, permissions, and the audit log entry for each record. A failing row doesn't stop the others.
5. Each row shows ✓ **Added** or ✗ with the reason. **Download results** gives the file back with a Result and Message column, so you can fix just the failures and import those again.

### Template columns

| List | Columns (* = required) |
|---|---|
| Districts | `code`*, `name`* |
| Branches | `code`*, `name`*, `district`* (the district's **code or exact name**) |
| Departments | `code`*, `name`*, `scope`* (`BANK`, `DISTRICT` or `BRANCH`), `district` (for DISTRICT scope: code or name), `branch` (for BRANCH scope: code or name) |
| Classified Categories | `code`*, `name`*, `scored` (`yes` / `no`, blank = no) |
| Sources | `code`*, `name`* |
| Uncovered Branch Reasons | `code`*, `name`* |

New records are created **Active**, as with the Add form.

---

## 5. For developers

| File | Role |
|---|---|
| `src/components/ui/AdminTable.tsx` | The shared MRT wrapper: defaults, toolbar, export, sticky pagination, detail panel, row actions column |
| `src/components/ui/RowActions.tsx` | `<RowActions>` / `<RowAction kind=…>`: the ⋯ row-action menu (MUI IconButton, Menu, MenuItem, MUI icons) |
| `src/components/ui/ImportCsvDialog.tsx` | The shared import dialog |
| `src/components/ui/MuiProvider.tsx` | MUI theme (brand colours, app font, light/dark) and Next.js style cache |
| `src/lib/csv.ts` | CSV build/parse, injection-safe cells, Excel-friendly UTF-8 |
| `src/lib/serverList.ts` | **Server paging for list APIs**: `listPageJson()` searches / filters / sorts / pages a list from `page`, `pageSize`, `q`, `sort`, `dir`, `f_<col>`, `fmin_<col>`, `fmax_<col>` |
| `src/lib/useServerList.ts` | Its client half: `useServerList()` for tables (`<AdminTable server={list}>`), `useServerPager()` for card lists |
| `src/lib/gridPage.ts`, `src/lib/gridParams.ts` | **Server paging for tables a Server Component computes** (Reports, dashboards): `gridPage()` pages the rows per the URL under the grid's prefix; the page calls `setGridParams()` once |
| `src/lib/useGridUrlState.ts` | Its client half (URL-driven page/search/filters/sort, export). Also used by the Findings list and Findings Report (plain parameter names, `pagedList()`, export from an API) |
| `src/lib/findingListQuery.ts` | Server-side search/sort for the Findings list, the Findings Report and `/api/findings/export`, so an export always matches the list |
| `src/components/dashboard/DashboardGrid.tsx`, `RankingGrid.tsx`, `src/components/reports/ReportSectionGrids.tsx` | Server halves of the dashboard/report grids (the `…Client` files are the tables) |

**A list backed by an API:**

```tsx
// API GET handler - without ?page it still returns the whole list (pickers use that)
const paged = listPageJson(request, "things", rows, {
  fields: { code: (r) => r.code, status: (r) => r.status, district: (r) => districtName(r.districtId) },
  exact: ["status", "district"], // dropdown filters (their values come back as facets)
});
if (paged) return NextResponse.json(paged);

// Page
const list = useServerList<Row>("/api/things", { key: "things", defaultSort: { id: "code", desc: false } });
<AdminTable columns={columns} server={list} getRowId={(r) => r.id} exportFileName="things"
  renderRowActions={(r) => <RowActions>…</RowActions>} />
// after a change: list.reload()
```

Field ids must match the column ids / `accessorKey`s, and return the same text the column shows, so search and filters match what users see.

**A table a Server Component computes:** wrap the client table in a server component that calls `gridPage(id, rows, getGridParams(), { fields, csv, … })` and passes the result as `grid`; in the client table, `const url = useGridUrlState(grid, columns, fileName)` and `<AdminTable columns={url.columns} data={grid.rows} onExport={url.onExport} tableOptions={url.tableOptions} />`.

**Options:**
- `tableOptions`: any MRT option. `initialState` and `state` are **merged** into AdminTable's defaults (compact density, search box, 25 rows), so pass only what differs; other options replace the default.
- `renderDetail`: your own detail panel (`(row) => …`), or `false` for none.
- **Versions:** material-react-table 3.2.1 with MUI 7. MUI 9 is newer than MRT supports, so **don't upgrade MUI** without checking MRT's compatibility first.
