// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { MRT_ColumnDef } from "material-react-table";
import { AdminTable } from "@/components/ui/AdminTable";

interface Row {
  id: string;
  name: string;
  email: string;
  phone: string;
}

const rows: Row[] = [
  { id: "u1", name: "Abebe Kebede", email: "abebe@bank.et", phone: "0911223344" },
  { id: "u2", name: "Sara Tesfaye", email: "sara@bank.et", phone: "0922334455" },
];

const columns: MRT_ColumnDef<Row>[] = [
  { accessorKey: "name", header: "Name" },
  { accessorKey: "email", header: "Email" },
  { accessorKey: "phone", header: "Phone" },
];

afterEach(cleanup);

describe("AdminTable master-detail", () => {
  it("a row's expand button opens its detail panel with every column, hidden ones included", () => {
    render(
      <AdminTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        tableOptions={{ initialState: { columnVisibility: { phone: false } } }}
      />
    );
    // Phone is hidden in the table itself.
    expect(screen.queryByText("0911223344")).toBeNull();

    const expandButtons = screen.getAllByRole("button", { name: /expand/i }).filter((b) => b.closest("tbody"));
    expect(expandButtons).toHaveLength(2);
    fireEvent.click(expandButtons[0]);

    const terms = screen.getAllByRole("term").map((t) => t.textContent);
    expect(terms).toEqual(["Name", "Email", "Phone"]);
    const panel = screen.getAllByRole("term")[0].closest("dl")!;
    expect(within(panel as HTMLElement).getByText("0911223344")).toBeTruthy();
    expect(within(panel as HTMLElement).queryByText("0922334455")).toBeNull();
  });

  it("renderDetail={false} shows no expand buttons", () => {
    render(<AdminTable columns={columns} data={rows} getRowId={(r) => r.id} renderDetail={false} />);
    expect(screen.queryAllByRole("button", { name: /expand/i })).toHaveLength(0);
  });

  it("a custom detail panel replaces the default one", () => {
    render(<AdminTable columns={columns} data={rows} getRowId={(r) => r.id} renderDetail={(r) => <p>Detail of {r.name}</p>} />);
    const expandButtons = screen.getAllByRole("button", { name: /expand/i }).filter((b) => b.closest("tbody"));
    fireEvent.click(expandButtons[1]);
    expect(screen.getByText("Detail of Sara Tesfaye")).toBeTruthy();
  });
});
