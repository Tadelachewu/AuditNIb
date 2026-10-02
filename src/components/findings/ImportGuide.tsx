import { CollapsibleCard } from "@/components/ui/CollapsibleCard";
import { Badge } from "@/components/ui/Badge";

// Column register - kept as data so the table below and any future export
// (e.g. a printable version) share one source of truth. `req` drives both
// the badge shown and its tone: "always" (hard-required, every row),
// "config" (required or not per Settings.requiredFindingFields, resolved
// at template-download time - see columnHeader() in src/lib/import.ts),
// "cond" (required only for one specific Status), or "opt" (never required).
const COLUMNS: {
  n: number;
  name: string;
  req: "always" | "config" | "cond" | "opt";
  format: string;
  note?: string;
}[] = [
  { n: 1, name: "District Code", req: "always", format: "D01", note: "Must exist and be active. Any letter case." },
  { n: 2, name: "Branch Code", req: "always", format: "B001", note: "Must exist, be active, and belong to the District Code on the same row." },
  {
    n: 3,
    name: "Reporting Period Code",
    req: "always",
    format: "2026-09",
    note: "The finding's own original period - for a Transferred row, this is where it started, not where it ended up. Any existing period, open or locked.",
  },
  { n: 4, name: "Source Code", req: "config", format: "IC / IA", note: "Must exist and be active." },
  {
    n: 5,
    name: "Department Code",
    req: "config",
    format: "OPS",
    note: "Must be active and available to the row's district/branch (bank-wide departments always qualify).",
  },
  { n: 6, name: "Classified Category Code", req: "config", format: "ATM_MISMATCH", note: "Must exist and be active - see the Reference Data sheet." },
  { n: 7, name: "Title", req: "config", format: "Short, specific", note: "Not part of duplicate matching - wording can vary freely." },
  {
    n: 8,
    name: "Finding Date",
    req: "config",
    format: "YYYY-MM-DD",
    note: "A real date in YYYY-MM-DD form (or an Excel date cell). Within the Reporting Period or earlier - never after the period ends, never in the future. Sets the finding's case age.",
  },
  { n: 9, name: "Operation Area", req: "config", format: "Teller Counter, Vault, …", note: "One of the configured values; letter case doesn't matter." },
  { n: 10, name: "Type of Irregularity", req: "config", format: "Cash Shortage, Fraud, …", note: "One of the configured values; letter case doesn't matter." },
  { n: 11, name: "Amount", req: "always", format: "61000", note: "A number, 0 or more (thousands commas allowed). The finding's full amount, not any outstanding remainder." },
  { n: 12, name: "Currency", req: "config", format: "ETB", note: "One of the bank's configured currencies; letter case doesn't matter." },
  { n: 13, name: "Number of Cases", req: "always", format: "3", note: "Whole number, at least 1. The finding's full case count." },
  { n: 14, name: "Risk Level", req: "config", format: "Low / Medium / High / Critical", note: "Configured value; letter case doesn't matter." },
  { n: 15, name: "Priority", req: "config", format: "Low / Medium / High / Urgent", note: "Configured value; letter case doesn't matter." },
  { n: 16, name: "Description", req: "config", format: "Free text" },
  { n: 17, name: "Recommendation", req: "config", format: "Free text" },
  { n: 18, name: "Evidence Note", req: "config", format: "Free text", note: "A note only - no file attachment via import." },
  {
    n: 19,
    name: "Status",
    req: "always",
    format: "SENT_TO_BRANCH_MANAGER / TRANSFERRED / CLOSED",
    note: "Case-insensitive, but spelled exactly.",
  },
  {
    n: 20,
    name: "Rectified Cases",
    req: "cond",
    format: "1",
    note: "How much was fixed before the transfer. Blank = zero progress. Ignored for the other two statuses.",
  },
  { n: 21, name: "Rectified Amount", req: "cond", format: "6000", note: "Must move together with Rectified Cases." },
  {
    n: 22,
    name: "Transferred To Period Code",
    req: "cond",
    format: "2026-10",
    note: "The period it moved into. Must be later than Reporting Period Code (open or locked).",
  },
  { n: 23, name: "External Reference", req: "opt", format: "Your own legacy file/ledger number", note: "Purely informational - never used for matching or numbering." },
  { n: 24, name: "Root Cause", req: "config", format: "Free text", note: "Why it happened (the form's Root cause field)." },
];

const REQ_LABEL: Record<(typeof COLUMNS)[number]["req"], { label: string; tone: "red" | "amber" | "blue" | "gray" }> = {
  always: { label: "Always", tone: "red" },
  config: { label: "Admin setting", tone: "amber" },
  cond: { label: "Status-conditional", tone: "blue" },
  opt: { label: "Optional", tone: "gray" },
};

const TEST_CASES: { n: number; scenario: string; status: string; key: string; outcome: "imported" | "duplicate" | "error"; detail: string }[] = [
  { n: 1, scenario: "Straightforward approval, nothing fixed", status: "SENT_TO_BRANCH_MANAGER", key: "All required fields filled", outcome: "imported", detail: "" },
  { n: 2, scenario: "Optional fields left blank (admin-configured off)", status: "SENT_TO_BRANCH_MANAGER", key: "Department Code, Finding Date blank", outcome: "imported", detail: "" },
  { n: 3, scenario: "Transferred with no progress before the move", status: "TRANSFERRED", key: "Rectified Cases/Amount blank; To 2026-10", outcome: "imported", detail: "" },
  { n: 4, scenario: "Transferred with partial progress before the move", status: "TRANSFERRED", key: "1 of 3 cases, 6,000 of 18,000; To 2026-10", outcome: "imported", detail: "" },
  { n: 5, scenario: "Fully resolved, single case", status: "CLOSED", key: "—", outcome: "imported", detail: "" },
  {
    n: 6,
    scenario: "Every Settings → Similar Findings field equals an existing finding",
    status: "any",
    key: "e.g. only Title differs (if Title isn't one of the chosen fields)",
    outcome: "duplicate",
    detail: "Shown for review - Import anyway or Cancel",
  },
  { n: 7, scenario: "Branch code doesn't exist", status: "any", key: "B999", outcome: "error", detail: 'Unknown branch code "B999"' },
  { n: 8, scenario: "Branch belongs to a different district than stated", status: "any", key: "D02 + B001 (B001 is under D01)", outcome: "error", detail: "Branch does not belong to district" },
  { n: 9, scenario: "Negative amount", status: "any", key: "-500", outcome: "error", detail: "Invalid amount" },
  { n: 10, scenario: "Category code doesn't exist", status: "any", key: "BADCODE", outcome: "error", detail: "Unknown classified category code" },
  { n: 11, scenario: "Required Title left blank", status: "any", key: "Title admin-required, blank", outcome: "error", detail: "Missing required value(s): Title" },
  { n: 12, scenario: "Transferred with no destination given", status: "TRANSFERRED", key: "Transferred To Period Code blank", outcome: "error", detail: "requires Transferred To Period Code" },
  { n: 13, scenario: "Transferred to its own origin period", status: "TRANSFERRED", key: "Reporting Period = Transferred To", outcome: "error", detail: "must differ from Reporting Period Code" },
  {
    n: 14,
    scenario: "Transferred but fully rectified already",
    status: "TRANSFERRED",
    key: "Rectified Cases = Number of Cases and Rectified Amount = Amount",
    outcome: "error",
    detail: "nothing would be outstanding - use CLOSED instead",
  },
  {
    n: 15,
    scenario: "Rectified Cases full but Amount isn't (or vice versa)",
    status: "TRANSFERRED",
    key: "3 of 3 cases, but 4,000 of 18,000",
    outcome: "error",
    detail: "the two must reach full together",
  },
  { n: 16, scenario: "Unrecognized status spelling", status: "SENT-TO-BRANCH", key: "Typo / wrong value", outcome: "error", detail: "must be one of the three listed statuses" },
  { n: 17, scenario: "Values in a different letter case", status: "closed", key: "teller counter, etb, low, b001", outcome: "imported", detail: "Saved as Teller Counter, ETB, Low, B001" },
  { n: 18, scenario: "Finding date after its reporting period", status: "any", key: "Period 2026-09, date 2026-10-05", outcome: "error", detail: "after reporting period 2026-09 (ends 2026-09-30)" },
  { n: 19, scenario: "Finding date before its reporting period", status: "any", key: "Period 2026-09, date 2026-06-12", outcome: "imported", detail: "Earlier dates are allowed" },
  { n: 20, scenario: "Date in another format", status: "any", key: "15/09/2026", outcome: "error", detail: "use YYYY-MM-DD" },
  { n: 21, scenario: "Several problems in one row", status: "any", key: "Bad branch + bad currency + bad amount", outcome: "error", detail: "All three are listed together" },
  { n: 22, scenario: "A branch or category that has been deactivated", status: "any", key: "Deactivated code", outcome: "error", detail: "is deactivated" },
];

const OUTCOME_TONE: Record<string, "green" | "amber" | "red"> = { imported: "green", duplicate: "amber", error: "red" };

/**
 * Reference documentation for whoever fills in the import template -
 * collapsed by default (see CollapsibleCard's own doc comment) so it
 * doesn't push the actual upload flow below the fold, but sits right where
 * someone would look for it. Content mirrors the published "Findings
 * Import Register" guide, re-expressed in this app's own component/style
 * language instead of that standalone document's design.
 */
export function ImportGuide() {
  return (
    <CollapsibleCard
      title="Import Guide"
      description="File rules, every validation rule, duplicates, reversing an import, and test cases - read this before filling in the template."
    >
      <div className="flex flex-col gap-8 p-4">
        {/* ---- Purpose ---- */}
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Purpose</h3>
          <p className="text-sm text-slate-600">
            This importer exists for one purpose: bringing an already-resolved or already-in-progress finding from a record
            predating this system into it, in bulk. It is <strong>not</strong> a faster way to register a brand-new finding -
            a genuinely new finding still belongs on <em>Register Finding</em>, one at a time, where it goes through District
            and HO Review exactly as the workflow requires. Every imported row is fast-forwarded straight to the status you
            declare, through the same mechanism a live approval/rectification/transfer uses, and is permanently marked in its
            history as a historical import - never as a live decision.
          </p>
        </div>

        {/* ---- Manual vs import ---- */}
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Manual registration vs. import</h3>
          <p className="text-sm text-slate-600">
            If you already register findings by hand, the template asks for almost the same information, in the same order -
            just as one spreadsheet row instead of one form.
          </p>
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-1.5 font-medium">On the Registration Form</th>
                  <th className="px-3 py-1.5 font-medium">In the Import File</th>
                  <th className="px-3 py-1.5 font-medium">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <td className="px-3 py-1.5">District / Branch dropdowns</td>
                  <td className="px-3 py-1.5 font-mono">District Code / Branch Code</td>
                  <td className="px-3 py-1.5 text-slate-500">Same codes shown on the form, typed instead of picked.</td>
                </tr>
                <tr>
                  <td className="px-3 py-1.5">Reporting period dropdown</td>
                  <td className="px-3 py-1.5 font-mono">Reporting Period Code</td>
                  <td className="px-3 py-1.5 text-slate-500">e.g. 2026-09</td>
                </tr>
                <tr>
                  <td className="px-3 py-1.5">Every field from Source through Evidence Note</td>
                  <td className="px-3 py-1.5 font-mono">Same 12 columns, same order</td>
                  <td className="px-3 py-1.5 text-slate-500">See the full register below.</td>
                </tr>
                <tr>
                  <td className="px-3 py-1.5 italic text-slate-500">(new findings are always Draft)</td>
                  <td className="px-3 py-1.5 font-mono">Status column</td>
                  <td className="px-3 py-1.5 text-slate-500">Only exists in the import file.</td>
                </tr>
                <tr>
                  <td className="px-3 py-1.5 italic text-slate-500">(entered on the live Rectify screen, later)</td>
                  <td className="px-3 py-1.5 font-mono">Rectified Cases / Amount</td>
                  <td className="px-3 py-1.5 text-slate-500">Only meaningful for a Transferred row.</td>
                </tr>
                <tr>
                  <td className="px-3 py-1.5">Itemized case amounts (optional checkbox)</td>
                  <td className="px-3 py-1.5 text-slate-500">not available</td>
                  <td className="px-3 py-1.5 text-slate-500">Import always produces the plain, non-itemized shape.</td>
                </tr>
                <tr>
                  <td className="px-3 py-1.5">Root Cause field</td>
                  <td className="px-3 py-1.5 font-mono">Root Cause (last column)</td>
                  <td className="px-3 py-1.5 text-slate-500">Older templates without it still import, unless Root cause is required.</td>
                </tr>
                <tr>
                  <td className="px-3 py-1.5 italic text-slate-500">(system-generated on save)</td>
                  <td className="px-3 py-1.5">Reference number</td>
                  <td className="px-3 py-1.5 text-slate-500">Never taken from your file, on either path.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* ---- Column register ---- */}
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Column register</h3>
          <p className="text-sm text-slate-600">
            Download a fresh template each session - the exact wording of &quot;required&quot; columns tracks the Admin&apos;s
            current Required Fields setting, and the Reference Data sheet lists every code currently valid.
          </p>
          <div className="max-h-96 overflow-y-auto overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-1.5 font-medium">#</th>
                  <th className="px-3 py-1.5 font-medium">Column</th>
                  <th className="px-3 py-1.5 font-medium">Required</th>
                  <th className="px-3 py-1.5 font-medium">Format / Example</th>
                  <th className="px-3 py-1.5 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {COLUMNS.map((c) => (
                  <tr key={c.n}>
                    <td className="px-3 py-1.5 text-slate-500">{c.n}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono text-slate-800">{c.name}</td>
                    <td className="px-3 py-1.5">
                      <Badge tone={REQ_LABEL[c.req].tone}>{REQ_LABEL[c.req].label}</Badge>
                    </td>
                    <td className="px-3 py-1.5 text-slate-600">{c.format}</td>
                    <td className="px-3 py-1.5 text-slate-500">{c.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">
            <Badge tone="red">Always</Badge> required on every row · <Badge tone="amber">Admin setting</Badge> required only if
            switched on under Required Fields · <Badge tone="blue">Status-conditional</Badge> required only for one specific
            Status · <Badge tone="gray">Optional</Badge> never required.
          </p>
        </div>

        {/* ---- Status guide ---- */}
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Status guide</h3>
          <p className="text-sm text-slate-600">
            Pick the status matching the finding&apos;s real, current state in the record you&apos;re backfilling - not a status
            you&apos;d like it to reach later. All three skip District Review and HO Review entirely; that step already
            happened, historically.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-3">
              <Badge tone="blue">SENT_TO_BRANCH_MANAGER</Badge>
              <p className="text-xs font-semibold text-slate-800">Approved. Nothing fixed yet.</p>
              <ul className="list-disc space-y-1 pl-4 text-xs text-slate-600">
                <li>Cleared review and sent to the branch, but no correction recorded at all.</li>
                <li>Ignores Rectified Cases/Amount and Transferred To Period Code even if filled in.</li>
              </ul>
            </div>
            <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-3">
              <Badge tone="amber">TRANSFERRED</Badge>
              <p className="text-xs font-semibold text-slate-800">Moved forward, still outstanding.</p>
              <ul className="list-disc space-y-1 pl-4 text-xs text-slate-600">
                <li>
                  <strong>Requires</strong> Transferred To Period Code - a real period (open or locked), later than Reporting Period Code.
                </li>
                <li>Rectified Cases/Amount optional (0 is fine); the full amount together is not - use CLOSED instead.</li>
                <li>Whatever&apos;s declared rectified is also treated as already closed - not left for a Controller to re-close.</li>
              </ul>
            </div>
            <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-3">
              <Badge tone="green">CLOSED</Badge>
              <p className="text-xs font-semibold text-slate-800">Fully resolved.</p>
              <ul className="list-disc space-y-1 pl-4 text-xs text-slate-600">
                <li>Every case and the full amount was corrected and closed already.</li>
                <li>No Rectified Cases/Amount needed - the importer fills the full case count/amount in for you.</li>
              </ul>
            </div>
          </div>
        </div>

        {/* ---- File rules ---- */}
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-slate-900">File rules</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
            <li>
              An Excel <strong>.xlsx</strong> file, up to <strong>10 MB</strong> and <strong>2,000 data rows</strong>. Split bigger
              files into several imports.
            </li>
            <li>
              The rows are read from the sheet named <span className="font-mono">Findings</span> (or the first sheet). Row 1 is the
              header; data starts on row 2. Completely empty rows are skipped.
            </li>
            <li>
              Columns are matched by their <strong>header text</strong>, not position. Keep the template&apos;s headers; column order
              and extra columns don&apos;t matter. A trailing &quot;(optional)&quot; in a header is ignored.
            </li>
            <li>Error messages give the Excel row number, so row 2 is the first data row.</li>
            <li>Up to 10 import attempts per user every 10 minutes.</li>
          </ul>
        </div>

        {/* ---- How validation works ---- */}
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-slate-900">How validation works</h3>
          <ul className="flex flex-col gap-2 text-sm text-slate-600">
            <li>
              <strong className="text-slate-800">Every problem is reported at once.</strong> The whole file is checked before
              anything is saved, and each row lists <em>all</em> of its problems together, not just the first. Fix everything in
              one pass and upload the whole file again.
            </li>
            <li>
              <strong className="text-slate-800">The whole file succeeds or none of it does.</strong> One real error rejects the
              entire file. A duplicate alone doesn&apos;t: it is skipped and the rest imports.
            </li>
            <li>
              <strong className="text-slate-800">Letter case doesn&apos;t matter.</strong> Codes (district, branch, period, source,
              department, category), Status, and list values (operation area, type of irregularity, currency, risk level,
              priority) match regardless of case, and are saved in the spelling configured in the system. Spelling and spaces
              inside the value must still match.
            </li>
            <li>
              <strong className="text-slate-800">Finding date must fit the period.</strong> It must be on or before the last day
              of the row&apos;s Reporting Period (earlier months are fine; later never), and not in the future. For a Transferred
              row this is the <em>original</em> period.
            </li>
            <li>
              <strong className="text-slate-800">Everything referenced must be active.</strong> Deactivated districts, branches,
              sources, departments and categories are rejected. The department must also be available to the row&apos;s
              district/branch.
            </li>
            <li>
              <strong className="text-slate-800">Your own scope applies.</strong> A district- or branch-level importer can only
              import rows for their own district or branch.
            </li>
            <li>
              <strong className="text-slate-800">Reference numbers are never yours to set.</strong> Always generated from the
              branch and the finding&apos;s <em>original</em> Reporting Period Code, even for a Transferred row.
            </li>
            <li>
              <strong className="text-slate-800">Finding Date drives the finding&apos;s recorded age.</strong> Case-age figures on
              every dashboard measure from it, not from today&apos;s import date.
            </li>
          </ul>
        </div>

        {/* ---- Duplicates ---- */}
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-slate-900">How duplicates are detected</h3>
          <p className="text-sm text-slate-600">
            The import uses the <strong>same rule as the Register Finding form</strong>, set by the administrator in{" "}
            <strong>Settings → Similar Findings</strong>. A row is a possible duplicate when <strong>every</strong> field chosen there has a
            value and is exactly equal to an existing finding (or an earlier row in the same file). Codes and list values are compared
            after their letter case is normalised.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
            <li>
              Duplicates are the <strong>final check</strong>: they&apos;re only looked for once every row has passed every other rule.
            </li>
            <li>
              If any are found, <strong>nothing is imported yet</strong>. You see each one with its evidence: the row, its title, the
              existing finding it matches (with a link, or &quot;row N of this file&quot;) and the matching values. Then choose{" "}
              <strong>Import anyway</strong> (every row is imported, duplicates included, each linked in the import history to the finding
              it matched) or <strong>Cancel import</strong>.
            </li>
            <li>For a Transferred row, the period compared is the one it moved <em>into</em>.</li>
            <li>
              If no fields are chosen in Settings → Similar Findings, duplicates are <strong>not checked</strong>. A row with a blank value
              in one of the chosen fields is never treated as a duplicate.
            </li>
          </ul>
        </div>

        {/* ---- Reversing ---- */}
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Reversing, re-importing and deleting an import</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
            <li>
              In <strong>Import History</strong>, <strong>Reverse</strong> removes every finding that import created, together with
              everything recorded against them (workflow history, rectifications, closures, transfers, comments, evidence files). It
              works <strong>whatever has happened to them since</strong>.
            </li>
            <li>
              Before confirming you see exactly what will be removed, including which findings have been worked on since the import.
              That work is deleted too, so you must tick to confirm it and give a reason.
            </li>
            <li>
              Choose <strong>Reverse import</strong> (the record stays, marked <em>Reversed</em>) or{" "}
              <strong>Reverse and delete record</strong> (it is removed from the history as well).
            </li>
            <li>
              A reversed import offers <strong>Re-import</strong>, which runs the stored original file through all the checks again
              (including the duplicate decision), and <strong>Delete record</strong>.
            </li>
            <li>
              Needs the <strong>Findings › Reverse an Import</strong> permission (Re-import also needs Bulk Import). The Administrator
              has it and can grant it to other roles. The audit log keeps every step, and removed reference numbers are never given
              to another finding.
            </li>
          </ul>
        </div>

        {/* ---- Checklist ---- */}
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Before you upload</h3>
          <ul className="grid grid-cols-1 gap-2 text-sm text-slate-600 sm:grid-cols-2">
            {[
              "Download a fresh template each session - required columns and valid codes can change.",
              "Copy codes and list values from the Reference Data sheet - case doesn't matter, spelling does.",
              "Finding dates in YYYY-MM-DD, within their Reporting Period or earlier, never later.",
              "Amount and Number of Cases are the finding's whole totals, not whatever's still outstanding.",
              "Transferred needs two different, real periods - its own origin, and a later open destination.",
              "No itemized case amounts - only the combined total survives import.",
              "This is not a live-review shortcut - a genuinely new finding belongs on Register Finding.",
              "Read every row of the result - a rejected file lists every problem to fix.",
            ].map((text) => (
              <li key={text} className="flex gap-2">
                <span className="text-emerald-600">✓</span>
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* ---- Test cases ---- */}
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Test cases</h3>
          <p className="text-sm text-slate-600">
            A worked set covering every outcome the importer can produce - use it to sanity-check your own file, or as a
            training file in a non-production environment before a real import run.
          </p>
          <div className="max-h-96 overflow-y-auto overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-1.5 font-medium">#</th>
                  <th className="px-3 py-1.5 font-medium">Scenario</th>
                  <th className="px-3 py-1.5 font-medium">Status</th>
                  <th className="px-3 py-1.5 font-medium">Key Values</th>
                  <th className="px-3 py-1.5 font-medium">Expected Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {TEST_CASES.map((t) => (
                  <tr key={t.n}>
                    <td className="px-3 py-1.5 text-slate-500">{t.n}</td>
                    <td className="px-3 py-1.5 text-slate-700">{t.scenario}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono text-slate-600">{t.status}</td>
                    <td className="px-3 py-1.5 text-slate-500">{t.key}</td>
                    <td className="px-3 py-1.5">
                      <Badge tone={OUTCOME_TONE[t.outcome]}>{t.outcome}</Badge>
                      {t.detail && <span className="ml-1.5 text-slate-500">{t.detail}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">
            Because validation is all-or-nothing, mixing an error row into an otherwise-clean file rejects the entire upload,
            including every valid row in it. Fix it, then re-upload the whole file.
          </p>
        </div>
      </div>
    </CollapsibleCard>
  );
}
