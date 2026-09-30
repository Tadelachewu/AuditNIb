# Tables: Search, Filter, Sort, Export and Import

Every list in the Administration area, plus the Findings list, the dashboards' rankings and the Reports page tables (§3), is built on **[Material React Table](https://www.material-react-table.com/)** (MRT v3, on MUI 7), themed to the app: brand gold, the chosen font and text size, and light/dark mode following the app's own toggle.

---

## 1. What every admin table can do

| Feature | How |
|---|---|
| **Search** | The search box at the top left searches **all columns** at once. |
| **Column filters** | The filter icon (≡) in the toolbar shows a filter under each column heading: text, or a dropdown for status, district, role and similar. |
| **Sort** | Click a column heading; click again to reverse. |
| **Show/hide columns** | The columns icon in the toolbar. |
| **Density** | Compact, normal or comfortable rows. |
| **Full screen** | The expand icon. |
| **Paging** | 10 / 25 / 50 / 100 / **All** per page, with first/last buttons. **All** shows every row on one page (on the Findings list it is saved in the address as `pageSize=all`). On very large lists All can take a moment to load. The page bar stays pinned to the bottom of the screen while you scroll. |
| **Row actions** | The **Actions ▾** menu in the last column (Edit, Activate/Deactivate, Delete, …), unchanged. |
| **Loading** | Skeleton rows while data loads. |
| **Export CSV** | A menu with two choices. **Rows shown** exports what you see: search, filters and sort applied, **all pages** (not only the current one). **Full table** exports every row, ignoring search and filters; on the Findings list and Findings Report that means every finding you have access to. Both export visible columns only and open correctly in Excel, including Amharic text. |
| **Bulk actions** | When rows are ticked (Findings, Uncovered Branches), the bulk-action bar sticks just under the top bar while you scroll, so the actions are always in reach. |
| **Import CSV** | On the reference-data lists (§4). |
| **Print** | Toolbars and page bars are left out of printouts and Print-to-PDF; only the rows print. |

**Security of exports:** a cell that starts with `=`, `+`, `-` or `@` is written with a leading `'`, so a spreadsheet shows it as text instead of running it as a formula ("CSV injection").

---

## 2. Lists and their features

| List | Search / filter / sort | Export | Import | Notes |
|---|---|---|---|---|
| Users | ✅ (filters: role, org unit, department, status) | ✅ | ✅ | Import: `username`*, `name`*, `email`*, `phone`, `role`* (code), `district`, `branch`, `department` (code or name), `temporary_password`*. Each row goes through the normal create-user checks; the user must change the temporary password at first sign-in (it expires in 24 h). The password column is **never** written to the results file; delete the CSV after importing. Export never includes passwords. |
| Districts | ✅ (status) | ✅ | ✅ | |
| Branches | ✅ (district, status) | ✅ | ✅ | Now loads every branch, so search covers the whole list. |
| Departments | ✅ (level, status) | ✅ | ✅ | |
| Classified Categories | ✅ (scored, status) | ✅ | ✅ | |
| Sources | ✅ (default, status) | ✅ | ✅ | The default source's row keeps its gold highlight. |
| Uncovered Branch Reasons | ✅ (status) | ✅ | ✅ | |
| Reporting Periods | ✅ (status) | ✅ | ❌ | Periods have lock rules and date windows; create them one at a time. |
| Audit Log | ✅ (actor, action, entity, **date range**), sort by time | ✅ **all matching entries** | ❌ | Runs on the **server**: the log can be very large, so search, filters, sort and paging are applied by the server. Export returns every matching entry, not just one page. |
| Roles, Scoring Rules | — | — | — | Expandable card lists with in-place editors, not tables; unchanged. |

---

## 3. Tables outside Administration

| Table | Where | Mode | Notes |
|---|---|---|---|
| **Findings list** | Findings | **Server** | Search, sort, page and page size live in the address bar (`q`, `sort`, `dir`, `page`, `pageSize`), so a view can be shared and survives refresh. The FilterBar above still does the filtering. **Export CSV** downloads every matching finding (`/api/findings/export`), not just the page. Row checkboxes and bulk actions are unchanged; clicking a row opens the finding. |
| **Findings Report** | Reports | **Server** | Same as the Findings list, read-only. The page's **Download CSV** button also includes the search and sort. The category/risk breakdowns and performance figures use every filtered finding, not just the searched ones. |
| **Branch / District Performance** | Dashboards, Reports | Client | Rank (always the official performance rank, whatever the sort), eligible / solved / unsolved cases, and performance %. Click a % to see its math or its adjustment reason. |
| **Transfers** | Reports | Client | Filters for period, method, transferred by, and amount/case/age ranges. |
| **Uncovered Branches** | Report Templates | Client, **no paging** | An official template that must print every branch at once. Search, sort, district filter and export; tick rows (or "select all" of what the search leaves) to apply one reason to many branches. The checkbox column doesn't print. |

**Left as they are:** the other report templates (fixed official layouts with their own Excel/PDF export), the small dashboard widgets (top-N cards), the Category and Risk breakdowns (a handful of fixed rows), and the import guide and batch preview tables.

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

## 4. For developers

| File | Role |
|---|---|
| `src/components/ui/AdminTable.tsx` | The shared MRT wrapper: defaults, toolbar, export, sticky pagination, row actions |
| `src/components/ui/ImportCsvDialog.tsx` | The shared import dialog |
| `src/components/ui/MuiProvider.tsx` | MUI theme (brand colours, app font, light/dark) and Next.js style cache; wraps the signed-in pages |
| `src/lib/csv.ts` | CSV build/parse, injection-safe cells, Excel-friendly UTF-8 |
| `src/lib/useUrlTableState.ts` | Server-mode table state kept in the URL (page, page size, sort, debounced search) plus `exportFrom(endpoint)`, used by the Findings list and Findings Report |
| `src/lib/findingListQuery.ts` | The server-side search/sort used by the Findings list, the Findings Report and `/api/findings/export`, so an export always matches the list |
| `src/components/dashboard/RankingGrid.tsx`, `src/components/reports/ReportGrids.tsx` | Rankings, Findings Report and Transfers grids |
| `src/app/api/admin/audit-log/route.ts` | Server-side search/filter/sort/paging and CSV export for the audit log |

**Adding a table to a list:**

```tsx
const columns = useMemo<MRT_ColumnDef<Row>[]>(() => [
  { accessorKey: "code", header: "Code" },                        // plain value = sort/filter/export value
  { accessorKey: "status", header: "Status", filterVariant: "select",
    Cell: ({ row }) => <StatusBadge status={row.original.status} /> }, // rich display
  { id: "district", header: "District", accessorFn: (r) => districtName(r.districtId),
    meta: { exportValue: (r: Row) => districtCode(r.districtId) } },   // optional export override
], [/* anything the cells read */]);

<AdminTable columns={columns} data={rows} isLoading={loading} getRowId={(r) => r.id}
  exportFileName="things" renderRowActions={(r) => <RowActions>…</RowActions>}
  toolbarActions={<ImportCsvDialog … />} />
```

- **Server-side mode** (for very large lists): when the server page reads `q`/`sort`/`dir`/`page`/`pageSize` from the URL, use the hook:
  ```tsx
  const url = useUrlTableState<Row>({ paging: { page, pageSize, total }, sort: { id, desc }, searchText });
  <AdminTable … onExport={() => url.exportFrom("/api/things/export")}
    tableOptions={{ ...url.tableOptions, enableColumnFilters: false, state: url.state }} />
  ```
  For state held in the component instead (the audit log page), pass `manualPagination`/`manualFiltering`/`manualSorting`, `rowCount`, the `on…Change` handlers and `state` yourself.
- `tableOptions` is spread last, so an `initialState` or `state` you pass **replaces** AdminTable's defaults. Repeat `density: "compact", showGlobalFilter: true` and the page size if you still want them.
- **Versions:** material-react-table 3.2.1 with MUI 7. MUI 9 is newer than MRT supports, so **don't upgrade MUI** without checking MRT's compatibility first.
