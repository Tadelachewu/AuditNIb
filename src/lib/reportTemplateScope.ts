import type { Database } from "@/types";
import type { SessionData } from "@/lib/session";
import { findingsInScope } from "@/lib/findings-scope";

/**
 * Report templates are bank-wide by default (docs/report-templates.md):
 * every district's figures, for comparisons and rankings. Settings ›
 * Report Template Visibility can instead limit district and branch users to
 * their own district / branch - stored as rankingVisibility.reportTemplates
 * ("OWN_SCOPE"; missing or "BANK" = bank-wide, today's behaviour).
 */
export function reportTemplatesOwnScopeOnly(db: Pick<Database, "settings">): boolean {
  return db.settings.rankingVisibility?.reportTemplates === "OWN_SCOPE";
}

/**
 * The data a report template (page or CSV export) is computed from for this
 * user. Bank-wide setting or a BANK-scoped user: the whole database,
 * unchanged. Otherwise a copy holding only the user's own district (or
 * branch): its findings and their history, its districts / branches and
 * their coverage notes - so every template, its filters and its export show
 * nothing of any other district without each one re-implementing the rule.
 */
export function reportTemplateDb(db: Database, session: SessionData): Database {
  if (!reportTemplatesOwnScopeOnly(db) || session.orgScope === "BANK") return db;

  const branches =
    session.orgScope === "DISTRICT"
      ? db.branches.filter((b) => b.districtId === session.districtId)
      : session.orgScope === "BRANCH"
        ? db.branches.filter((b) => b.id === session.branchId)
        : [];
  const districtIds = new Set<string>(
    session.orgScope === "DISTRICT" && session.districtId ? [session.districtId] : branches.map((b) => b.districtId),
  );
  const branchIds = new Set(branches.map((b) => b.id));
  const findings = findingsInScope(db, session);
  const findingIds = new Set(findings.map((f) => f.id));
  const ofFinding = <T extends { findingId: string }>(rows: T[] | undefined): T[] => (rows ?? []).filter((r) => findingIds.has(r.findingId));

  return {
    ...db,
    districts: db.districts.filter((d) => districtIds.has(d.id)),
    branches,
    findings,
    findingTransitions: ofFinding(db.findingTransitions),
    rectifications: ofFinding(db.rectifications),
    findingTransfers: ofFinding(db.findingTransfers),
    findingClosures: ofFinding(db.findingClosures),
    findingAdjustments: ofFinding(db.findingAdjustments),
    findingCases: ofFinding(db.findingCases),
    evidence: ofFinding(db.evidence),
    comments: ofFinding(db.comments),
    branchCoverageNotes: (db.branchCoverageNotes ?? []).filter((n) => branchIds.has(n.branchId)),
  };
}

/** Shown on a template when it's limited to the viewer's own unit, so its totals aren't read as the bank's. */
export function reportTemplateScopeNote(db: Database, session: SessionData): string | null {
  if (!reportTemplatesOwnScopeOnly(db) || session.orgScope === "BANK") return null;
  return session.orgScope === "BRANCH" ? "Showing your branch only." : "Showing your district only.";
}
