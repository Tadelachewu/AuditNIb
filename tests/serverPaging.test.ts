import { describe, expect, it } from "vitest";
import { listPageJson, parseListQuery, runListQuery } from "@/lib/serverList";
import { gridPage } from "@/lib/gridPage";

interface Row {
  id: string;
  name: string;
  district: string;
  status: "ACTIVE" | "INACTIVE";
  cases: number | null;
}

const rows: Row[] = Array.from({ length: 30 }, (_, i) => ({
  id: `r${i + 1}`,
  name: `Branch ${String(i + 1).padStart(2, "0")}`,
  district: i % 3 === 0 ? "Adama" : i % 3 === 1 ? "Bahir Dar" : "Addis Ababa",
  status: i % 5 === 0 ? "INACTIVE" : "ACTIVE",
  cases: i === 4 ? null : i,
}));

const spec = {
  fields: {
    name: (r: Row) => r.name,
    district: (r: Row) => r.district,
    status: (r: Row) => r.status,
    cases: (r: Row) => r.cases,
  },
  search: ["name", "district"],
  exact: ["district", "status"],
};

const query = (qs: string) => parseListQuery(new URLSearchParams(qs));

describe("server-side list paging (runListQuery)", () => {
  it("returns one page and the total of every matching row", () => {
    const res = runListQuery(rows, query("page=2&pageSize=10"), spec);
    expect(res.items.map((r) => r.id)).toEqual(["r11", "r12", "r13", "r14", "r15", "r16", "r17", "r18", "r19", "r20"]);
    expect(res.total).toBe(30);
    expect(res.totalPages).toBe(3);
  });

  it("a page past the end gives the last page", () => {
    const res = runListQuery(rows, query("page=9&pageSize=10"), spec);
    expect(res.page).toBe(3);
    expect(res.items[0].id).toBe("r21");
  });

  it("pageSize=all returns everything", () => {
    expect(runListQuery(rows, query("page=1&pageSize=all"), spec).items).toHaveLength(30);
  });

  it("searches every word, case-insensitively, across the fields", () => {
    const res = runListQuery(rows, query("page=1&q=BAHIR branch 0"), spec);
    expect(res.items.map((r) => `${r.name} / ${r.district}`)).toEqual([
      "Branch 02 / Bahir Dar",
      "Branch 05 / Bahir Dar",
      "Branch 08 / Bahir Dar",
      "Branch 20 / Bahir Dar",
    ]);
  });

  it("dropdown filters match exactly; text filters match a part", () => {
    expect(runListQuery(rows, query("page=1&f_district=Adama"), spec).total).toBe(10);
    expect(runListQuery(rows, query("page=1&f_district=Ada"), spec).total).toBe(0); // exact field
    expect(runListQuery(rows, query("page=1&f_name=nch 1"), spec).total).toBe(10); // Branch 10-19
  });

  it("range filters keep values between min and max, and drop blanks", () => {
    const res = runListQuery(rows, query("page=1&pageSize=all&fmin_cases=3&fmax_cases=6"), spec);
    expect(res.items.map((r) => r.cases)).toEqual([3, 5, 6]); // 4 is blank (null)
  });

  it("sorts by any field, blanks last in both directions", () => {
    const asc = runListQuery(rows, query("page=1&pageSize=all&sort=cases&dir=asc"), spec).items.map((r) => r.cases);
    const desc = runListQuery(rows, query("page=1&pageSize=all&sort=cases&dir=desc"), spec).items.map((r) => r.cases);
    expect(asc[0]).toBe(0);
    expect(asc.at(-1)).toBeNull();
    expect(desc[0]).toBe(29);
    expect(desc.at(-1)).toBeNull();
  });

  it("sorts names in natural order", () => {
    const res = runListQuery([{ ...rows[0], name: "Branch 10" }, { ...rows[1], name: "Branch 9" }], query("page=1&sort=name"), spec);
    expect(res.items.map((r) => r.name)).toEqual(["Branch 9", "Branch 10"]);
  });

  it("lists every dropdown value of the whole list (facets), whatever the page", () => {
    const res = runListQuery(rows, query("page=3&pageSize=5&f_status=ACTIVE"), spec);
    expect(res.facets.district).toEqual(["Adama", "Addis Ababa", "Bahir Dar"]);
    expect(res.facets.status).toEqual(["ACTIVE", "INACTIVE"]);
  });
});

describe("list APIs (listPageJson)", () => {
  it("without page, the API keeps returning its whole list", () => {
    expect(listPageJson(new Request("http://x/api/admin/branches"), "branches", rows, spec)).toBeNull();
  });

  it("with page, returns that page under the list's own key", () => {
    const json = listPageJson(new Request("http://x/api/admin/branches?page=1&pageSize=5&f_status=INACTIVE"), "branches", rows, spec)!;
    expect((json.branches as Row[]).map((r) => r.id)).toEqual(["r1", "r6", "r11", "r16", "r21"]);
    expect(json.total).toBe(6);
    expect(json.totalPages).toBe(2);
  });
});

describe("server-rendered grids (gridPage)", () => {
  const gspec = {
    ...spec,
    defaultSort: { id: "cases", desc: true },
    csv: [
      { header: "Name", value: (r: Row) => r.name },
      { header: "Cases", value: (r: Row) => r.cases },
    ],
  };

  it("reads only its own prefixed URL parameters", () => {
    const params = new URLSearchParams("page=3&q=zzz&bp.page=2&bp.size=10&bp.f.district=Adama&other.q=x");
    const g = gridPage("bp", rows, params, gspec);
    expect(g.total).toBe(10);
    expect(g.page).toBe(1); // 10 Adama rows fit on one page of 10 -> page 2 clamps to 1
    expect(g.filters).toEqual([{ id: "district", value: "Adama" }]);
    expect(g.sort).toEqual({ id: "cases", desc: true });
    expect(g.csv).toBeNull();
  });

  it("keeps range filters as [min, max] and the search text as typed", () => {
    const g = gridPage("bp", rows, new URLSearchParams("bp.min.cases=10&bp.q=Branch 1"), gspec);
    expect(g.filters).toEqual([{ id: "cases", value: ["10", ""] }]);
    expect(g.q).toBe("Branch 1");
    expect(g.total).toBe(10); // cases >= 10 and "1" in the name: Branch 11-19 and 21
  });

  it("export=shown sends the CSV of every matching row (all pages); export=all ignores the filters", () => {
    const shown = gridPage("bp", rows, new URLSearchParams("bp.size=5&bp.f.district=Adama&bp.export=shown"), gspec);
    expect(shown.rows).toHaveLength(5);
    const shownLines = shown.csv!.content.split("\r\n");
    expect(shownLines[0]).toBe("Name,Cases");
    expect(shownLines).toHaveLength(1 + 10);
    expect(shownLines[1]).toBe("Branch 28,27"); // sorted like the table (cases, highest first)

    const all = gridPage("bp", rows, new URLSearchParams("bp.f.district=Adama&bp.export=all"), gspec);
    expect(all.csv!.scope).toBe("all");
    expect(all.csv!.content.split("\r\n")).toHaveLength(1 + 30);
  });
});
