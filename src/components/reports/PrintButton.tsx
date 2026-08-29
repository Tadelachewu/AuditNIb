"use client";

import { Button } from "@/components/ui/Button";

// The browser's native print dialog + this page's @media print rules
// (src/app/(app)/reports/page.tsx) is a genuine, working PDF export via
// "Save as PDF" - no PDF-rendering dependency added (see PHASE7.md).
export function PrintButton() {
  return <Button variant="secondary" onClick={() => window.print()}>Print / Save as PDF</Button>;
}
