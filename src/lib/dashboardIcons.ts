// One shared icon+color per dashboard stat concept, so the same StatCard
// label (e.g. "Total Findings," "Outstanding Amount") reads with the same
// glyph AND the same meaning-carrying color on every dashboard it appears
// on (Branch/District/HO/Executive/Admin), rather than each file picking
// its own or every tile reading as equally neutral gray. Named by concept,
// not by exact label text - "Rectified Findings" and "Rectified Cases"
// intentionally share RECTIFIED, since the icon/color represents the
// underlying idea (fixed/closed) and the label text itself already
// distinguishes the unit (findings vs cases). Districts/Branches/Scoring
// Rules/Reporting Periods deliberately reuse the exact same icons
// src/lib/nav.ts already uses for those same concepts in the sidebar, for
// the same "same thing, same icon everywhere" reason.
//
// Tone follows the same semantic language as Button's own variants
// (src/components/ui/Button.tsx) and Badge's tones: emerald for a good/
// completed outcome, red for something negative or at-risk, amber for
// something pending/needing attention, blue for a plain volume total or
// forward motion, gold reserved for the one headline Performance metric
// each dashboard has, slate for neutral admin/reference counts.
import {
  Files,
  Layers,
  Eye,
  CheckCircle2,
  Clock,
  XCircle,
  Undo2,
  FileCheck2,
  ArrowRightLeft,
  Gauge,
  Wallet,
  HandCoins,
  CircleDollarSign,
  Inbox,
  Wrench,
  FilePenLine,
  AlertTriangle,
  AlertOctagon,
  Timer,
  Users,
  Calculator,
  Building2,
  Map,
  CalendarClock,
  Hourglass,
  Scale,
  type LucideIcon,
} from "lucide-react";
import type { StatTone } from "@/components/ui/Card";

interface DashboardStatIcon {
  icon: LucideIcon;
  tone: StatTone;
}

export const DASHBOARD_ICONS = {
  totalFindings: { icon: Files, tone: "blue" },
  totalCases: { icon: Layers, tone: "blue" },
  requiringReview: { icon: Eye, tone: "amber" },
  approved: { icon: CheckCircle2, tone: "emerald" },
  outstanding: { icon: Clock, tone: "amber" },
  outstandingCases: { icon: Clock, tone: "amber" },
  rejected: { icon: XCircle, tone: "red" },
  returned: { icon: Undo2, tone: "amber" },
  rectified: { icon: FileCheck2, tone: "emerald" },
  transferred: { icon: ArrowRightLeft, tone: "blue" },
  performance: { icon: Gauge, tone: "gold" },
  totalAmount: { icon: Wallet, tone: "slate" },
  resolvedAmount: { icon: HandCoins, tone: "emerald" },
  outstandingAmount: { icon: CircleDollarSign, tone: "red" },
  pendingApproval: { icon: Inbox, tone: "amber" },
  pendingRectification: { icon: Wrench, tone: "amber" },
  draft: { icon: FilePenLine, tone: "slate" },
  highRisk: { icon: AlertTriangle, tone: "red" },
  criticalExceptions: { icon: AlertOctagon, tone: "red" },
  backlogAge: { icon: Timer, tone: "amber" },
  activeUsers: { icon: Users, tone: "slate" },
  activeScoringRule: { icon: Calculator, tone: "slate" },
  branches: { icon: Building2, tone: "slate" },
  districts: { icon: Map, tone: "slate" },
  openPeriods: { icon: CalendarClock, tone: "slate" },
  adjustmentsPending: { icon: Hourglass, tone: "amber" },
  adjustmentDiff: { icon: Scale, tone: "blue" },
} satisfies Record<string, DashboardStatIcon>;
