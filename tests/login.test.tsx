// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
// eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
vi.mock("next/image", () => ({ default: (props: Record<string, unknown>) => <img {...(props as object)} /> }));
vi.mock("@/lib/api-client", () => ({ apiSend: vi.fn(async () => ({})) }));
vi.mock("@/lib/notify", async (orig) => ({
  ...(await orig<typeof import("@/lib/notify")>()),
  notify: { success: vi.fn(), warning: vi.fn(), loginError: vi.fn() },
}));

import { LoginClient } from "@/components/auth/LoginClient";
import { apiSend } from "@/lib/api-client";

afterEach(cleanup);

const signIn = () => screen.getByRole("button", { name: "Sign in" });
const username = () => screen.getByLabelText("Username");
const password = () => screen.getByLabelText("Password");

beforeEach(() => {
  vi.mocked(apiSend).mockClear();
  render(<LoginClient demoUsers={null} />);
});

describe("sign-in form validation", () => {
  it("Sign in is disabled while either field is empty", () => {
    expect((signIn() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(username(), { target: { value: "ho.controller" } });
    expect((signIn() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(password(), { target: { value: "Secret@123" } });
    expect((signIn() as HTMLButtonElement).disabled).toBe(false);
  });

  it("stays disabled until the minimum lengths are met (username 3+, password 8+)", () => {
    fireEvent.change(username(), { target: { value: "ab" } });
    fireEvent.change(password(), { target: { value: "a" } });
    expect((signIn() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.blur(username());
    fireEvent.blur(password());
    expect(screen.queryByText("Username must be at least 3 characters.")).not.toBeNull();
    expect(screen.queryByText("Password must be at least 8 characters.")).not.toBeNull();
    fireEvent.change(username(), { target: { value: "abc" } });
    fireEvent.change(password(), { target: { value: "12345678" } });
    expect((signIn() as HTMLButtonElement).disabled).toBe(false);
  });

  it("a username of only spaces doesn't count", () => {
    fireEvent.change(username(), { target: { value: "   " } });
    fireEvent.change(password(), { target: { value: "Secret@123" } });
    expect((signIn() as HTMLButtonElement).disabled).toBe(true);
  });

  it("'required' shows only after leaving an empty field", () => {
    expect(screen.queryByText("Username is required.")).toBeNull();
    fireEvent.blur(username());
    expect(screen.queryByText("Username is required.")).not.toBeNull();
    expect(username().getAttribute("aria-invalid")).toBe("true");
    fireEvent.blur(password());
    expect(screen.queryByText("Password is required.")).not.toBeNull();
  });

  it("the message clears once the field is filled", () => {
    fireEvent.blur(username());
    fireEvent.change(username(), { target: { value: "ho.controller" } });
    expect(screen.queryByText("Username is required.")).toBeNull();
  });

  it("submitting with empty fields (e.g. pressing Enter) never calls the server", () => {
    fireEvent.submit(signIn().closest("form")!);
    expect(apiSend).not.toHaveBeenCalled();
    expect(screen.queryByText("Username is required.")).not.toBeNull();
  });

  it("valid input is sent (username trimmed)", async () => {
    fireEvent.change(username(), { target: { value: "  ho.controller " } });
    fireEvent.change(password(), { target: { value: "Secret@123" } });
    fireEvent.click(signIn());
    await vi.waitFor(() => expect(apiSend).toHaveBeenCalledWith("/api/auth/login", "POST", { username: "ho.controller", password: "Secret@123" }));
  });
});
