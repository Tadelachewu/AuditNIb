// Client-safe report template metadata - no server imports, so "use client"
// components (e.g. /admin/settings' Report Template Source Filters) can
// import it without dragging src/lib/findings.ts (and node:crypto via
// src/lib/audit.ts) into the browser bundle. Re-exported from
// src/lib/reportTemplates.ts, so server code can keep importing from there.

// Single source of truth for slug <-> permission action <-> display copy,
// shared by the hub page, each template page, and the CSV export route -
// so there's exactly one place that needs updating if a template's slug,
// permission, or description ever changes.
export interface ReportTemplateMeta {
  slug: string;
  action: string;
  label: string;
  description: string;
}

export const REPORT_TEMPLATES: ReportTemplateMeta[] = [
  { slug: "uncovered-branches", action: "uncovered-branches", label: "Uncovered Branches", description: "Branches with no findings submitted this period, and why." },
  { slug: "category-detail-by-district", action: "category-detail-by-district", label: "Category Detail by District", description: "Every district x classified-case category, Unrectified/Rectified." },
  { slug: "monthly-summary", action: "monthly-summary", label: "Monthly Summary Report", description: "Category detail plus amount involved and branch dispatch coverage." },
  { slug: "monthly-district-history", action: "monthly-district-history", label: "Monthly District History", description: "Other-Case performance by district, filterable by reporting period." },
  { slug: "monthly-district-detail", action: "monthly-district-detail", label: "Monthly District Detail", description: "The same district/period history as a flat, long-format table." },
  { slug: "district-ranking-other-cases", action: "district-ranking-other-cases", label: "District Ranking - Other Cases", description: "Cumulative district ranking on the official scored category." },
  { slug: "weekly-executive-summary", action: "weekly-executive-summary", label: "Weekly Executive Summary", description: "Every classified category x district, balance carried forward this week vs. last week." },
  { slug: "district-ranking-all-cases", action: "district-ranking-all-cases", label: "District Ranking - All Cases", description: "District ranking across every classified-case category." },
  { slug: "category-performance-summary", action: "category-performance-summary", label: "Category Performance Summary", description: "Bank-wide rectification rate per category, with the district range." },
  { slug: "mid-month-district-snapshot", action: "mid-month-district-snapshot", label: "Mid-Month District Snapshot", description: "District performance as of any chosen cutoff date within a period." },
  { slug: "transferred-findings", action: "transferred-findings", label: "Transferred Findings", description: "Every transfer hop: original-period detail, what happened before it left, where it went, and its status today." },
];
