// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { EMPTY_SELECTION, RecipientPicker } from "@/components/communications/RecipientPicker";
import type { Directory, RecipientSelection } from "@/lib/communications/types";

// The Communications "To" picker: tick Roles / Districts / Branches / People;
// roles narrow to the ticked places; the count is exactly who receives it.

afterEach(() => {
  cleanup();
  seen.value = EMPTY_SELECTION;
});

const u = (id: string, roleCode: string, roleName: string, districtId: string | null, branchId: string | null) => ({
  id,
  name: id.toUpperCase(),
  roleCode,
  roleName,
  districtId,
  branchId,
  districtName: districtId === "d1" ? "Addis" : districtId === "d2" ? "Hawassa" : null,
  branchName: branchId === "b1" ? "Bole" : branchId === "b2" ? "Tabor" : branchId === "b3" ? "Piassa" : null,
});
const dir: Directory = {
  users: [
    u("bm1", "BM", "Branch Manager", "d1", "b1"),
    u("bm3", "BM", "Branch Manager", "d1", "b3"),
    u("bm2", "BM", "Branch Manager", "d2", "b2"),
    u("bc1", "BC", "Branch Controller", "d1", "b1"),
    u("dc1", "DC", "District Controller", "d1", null),
    u("ho1", "HO", "HO Controller", null, null),
  ],
  roles: [
    { code: "BC", name: "Branch Controller" },
    { code: "BM", name: "Branch Manager" },
    { code: "DC", name: "District Controller" },
    { code: "HO", name: "HO Controller" },
  ],
  districts: [
    { id: "d1", name: "Addis" },
    { id: "d2", name: "Hawassa" },
  ],
  branches: [
    { id: "b1", name: "Bole", districtId: "d1" },
    { id: "b2", name: "Tabor", districtId: "d2" },
    { id: "b3", name: "Piassa", districtId: "d1" },
  ],
};

// The picker's latest selection, captured as it reports changes.
const seen: { value: RecipientSelection } = { value: EMPTY_SELECTION };
function Harness() {
  const [value, setValue] = useState<RecipientSelection>(EMPTY_SELECTION);
  return (
    <RecipientPicker
      dir={dir}
      value={value}
      onChange={(next) => {
        seen.value = next;
        setValue(next);
      }}
    />
  );
}
const tick = (label: string) => fireEvent.click(within(screen.getByRole("list", { name: /list$/ })).getByText(label).closest("label")!.querySelector("input")!);
const openTab = (name: string) => fireEvent.click(screen.getByRole("tab", { name: new RegExp(name) }));
const reach = () => screen.queryByText(/→ \d+/)?.textContent ?? "Nobody";
/** The picker is a dropdown: open it from its button. */
const openPicker = () => fireEvent.click(screen.getByRole("button", { expanded: false }));
function renderOpen() {
  render(<Harness />);
  openPicker();
}

describe("Communications To picker", () => {
  it("is a dropdown: closed at first, opens from its button, Done closes it and the button sums up the choice", () => {
    render(<Harness />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: /Choose recipients/ })).toBeTruthy();
    openPicker();
    expect(screen.getByRole("dialog", { name: "Choose recipients" })).toBeTruthy();
    tick("Branch Manager");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: /3 people · Branch Manager/ })).toBeTruthy();
  });

  it("Escape closes it", () => {
    renderOpen();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("tick a role, then a district: that role IN that district", () => {
    renderOpen();
    tick("Branch Manager");
    expect(reach()).toMatch(/→ 3 people/);
    openTab("Districts");
    tick("Addis");
    expect(reach()).toMatch(/→ 2 people/);
    expect(seen.value).toMatchObject({ roleCodes: ["BM"], districtIds: ["d1"] });
  });

  it("the Branches tab lists only the ticked districts' branches; a ticked branch narrows to it", () => {
    renderOpen();
    openTab("Districts");
    tick("Addis");
    openTab("Branches");
    const list = within(screen.getByRole("list", { name: /list$/ }));
    expect(list.queryByText("Tabor")).toBeNull();
    tick("Bole");
    expect(reach()).toMatch(/→ 2 people/); // BM1 + BC1 at Bole only
  });

  it("People: untick someone to leave them out, tick anyone to add them", () => {
    renderOpen();
    tick("Branch Manager");
    openTab("People");
    tick("BM2"); // was included via the role - now excluded
    expect(reach()).toMatch(/→ 2 people/);
    tick("HO1"); // not in any group - added
    expect(reach()).toMatch(/→ 3 people/);
    expect(seen.value).toMatchObject({ userIds: ["ho1"], excludedUserIds: ["bm2"] });
  });

  it("filter box + Select all (shown); Everyone; the reach list by branch", () => {
    renderOpen();
    fireEvent.change(screen.getByLabelText("Filter roles"), { target: { value: "branch" } });
    fireEvent.click(screen.getByLabelText(/Select all \(2\)/));
    expect(seen.value.roleCodes.sort()).toEqual(["BC", "BM"]);
    fireEvent.click(screen.getByText(/→ 4 people/));
    expect(screen.getByText("Bole (2)")).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Everyone/));
    expect(seen.value.toAll).toBe(true);
  });
});

describe("Cc picker", () => {
  it("has no Everyone option and its own button text", () => {
    render(<RecipientPicker dir={dir} value={EMPTY_SELECTION} onChange={() => {}} label="Cc" allowEveryone={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Add people to Cc/ }));
    expect(screen.getByRole("dialog", { name: "Choose Cc recipients" })).toBeTruthy();
    expect(screen.queryByLabelText(/Everyone/)).toBeNull();
  });
});
