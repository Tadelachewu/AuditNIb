// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RowAction, RowActions, StatusToggleAction } from "@/components/ui/RowActions";

afterEach(cleanup);

describe("RowActions (Material UI row-action menu)", () => {
  it("renders nothing when the user may do none of the actions", () => {
    const canEdit = false;
    const { container } = render(<RowActions>{canEdit && <RowAction kind="edit" />}</RowActions>);
    expect(container.innerHTML).toBe("");
  });

  it("the ... button opens the menu; an action runs and closes it", () => {
    const onEdit = vi.fn();
    render(
      <RowActions>
        <RowAction kind="edit" onClick={onEdit} />
        <StatusToggleAction active onClick={() => {}} />
        <RowAction kind="delete" onClick={() => {}} />
      </RowActions>
    );
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    const items = screen.getAllByRole("menuitem").map((i) => i.textContent);
    expect(items).toEqual(["Edit", "Deactivate", "Delete"]);
    expect(screen.getByRole("separator")).toBeTruthy(); // Delete sits below a divider

    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it("a disabled action is greyed out with its reason shown", () => {
    const onDelete = vi.fn();
    render(
      <RowActions>
        <RowAction kind="delete" disabled title="3 finding(s) reference this period" onClick={onDelete} />
      </RowActions>
    );
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    const item = screen.getByRole("menuitem");
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("3 finding(s) reference this period")).toBeTruthy();
  });

  it("while an action runs, the button is disabled", () => {
    render(
      <RowActions>
        <RowAction kind="lock" busy />
      </RowActions>
    );
    expect((screen.getByRole("button", { name: "Actions" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
