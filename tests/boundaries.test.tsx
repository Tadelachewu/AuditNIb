// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

import AppError from "@/app/(app)/error";
import RootSegmentError from "@/app/error";
import NotFound from "@/app/not-found";

afterEach(cleanup);

const internal = Object.assign(new Error("SELECT * FROM users WHERE password='x' at /srv/app/src/lib/db.ts:42"), { digest: "1234567890" });

describe("error boundaries", () => {
  it("(app)/error.tsx shows a generic message + reference, never the raw error, and retries", () => {
    const retry = vi.fn();
    render(<AppError error={internal} retry={retry} />);
    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(screen.getByText("Reference: 1234567890")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/SELECT|password|db\.ts/);
    fireEvent.click(screen.getByText("Try Again"));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("root error.tsx (login/reset pages) is generic too", () => {
    render(<RootSegmentError error={internal} retry={() => {}} />);
    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/SELECT|password/);
  });

  it("not-found.tsx offers a way back", () => {
    render(<NotFound />);
    expect(screen.getByText("Page not found")).toBeTruthy();
    expect(screen.getByText("Go to Dashboard").getAttribute("href")).toBe("/dashboard");
  });
});
