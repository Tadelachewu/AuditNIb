export interface DateRange {
  from?: string;
  to?: string;
}

/** Reads dateFrom/dateTo off a page's searchParams - same convention as TimeRangeFilter/Reports page. */
export function parseDateRange(params: Record<string, string | string[] | undefined>): DateRange {
  return {
    from: typeof params.dateFrom === "string" && params.dateFrom ? params.dateFrom : undefined,
    to: typeof params.dateTo === "string" && params.dateTo ? params.dateTo : undefined,
  };
}

/** findingDate is YYYY-MM-DD, so plain string comparison against the range bounds works. */
export function inDateRange(range: DateRange, findingDate: string): boolean {
  if (range.from && findingDate < range.from) return false;
  if (range.to && findingDate > range.to) return false;
  return true;
}
