import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiSend, apiUpload, errorMessage, toApiError } from "@/lib/api-client";

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

afterEach(() => vi.unstubAllGlobals());

describe("toApiError", () => {
  it("reads the standard contract", async () => {
    const e = await toApiError(
      json({ success: false, error: { code: "IMPORT_NOT_REVERSIBLE", message: "Can't reverse", details: { blockers: ["x"] } }, requestId: "rid-12345678" }, 409)
    );
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 409, code: "IMPORT_NOT_REVERSIBLE", message: "Can't reverse", requestId: "rid-12345678" });
    expect(e.details).toEqual({ blockers: ["x"] });
  });

  it("exposes field errors for forms", async () => {
    const e = await toApiError(json({ success: false, error: { code: "VALIDATION_ERROR", message: "Bad", details: { fieldErrors: { name: ["Required"] } } }, requestId: null }, 422));
    expect(e.fieldErrors).toEqual({ name: ["Required"] });
  });

  it("still understands the legacy { error } shape", async () => {
    const e = await toApiError(json({ error: "Nope", rows: [1] }, 400, { "x-request-id": "hdr-12345678" }));
    expect(e).toMatchObject({ message: "Nope", status: 400, requestId: "hdr-12345678" });
    expect(e.details).toEqual({ rows: [1] });
  });

  it("handles a non-JSON failure (proxy / gateway page) safely", async () => {
    const e = await toApiError(new Response("<html>502 Bad Gateway nginx/1.2</html>", { status: 502 }));
    expect(e.status).toBe(502);
    expect(e.message).toBe("Something went wrong. Please try again.");
  });
});

describe("request helpers", () => {
  it("turns a network failure into NETWORK_ERROR", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    await expect(apiSend("/api/x", "POST", {})).rejects.toMatchObject({ code: "NETWORK_ERROR", status: 0 });
  });

  it("throws ApiError for failures and returns JSON for success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ success: false, error: { code: "AUTHORIZATION_DENIED", message: "No", details: null }, requestId: "r1234567" }, 403)));
    await expect(apiSend("/api/x", "DELETE")).rejects.toMatchObject({ code: "AUTHORIZATION_DENIED", status: 403 });
    vi.stubGlobal("fetch", vi.fn(async () => json({ ok: true }, 200)));
    await expect(apiUpload("/api/upload", new FormData())).resolves.toEqual({ ok: true });
  });
});

describe("errorMessage", () => {
  it("shows the safe API message, with a reference for server errors", () => {
    expect(errorMessage(new ApiError("Name is required", 422, { requestId: "abcdef12-9999" }))).toBe("Name is required");
    expect(errorMessage(new ApiError("Something went wrong. Please try again.", 500, { requestId: "abcdef12-9999" }))).toBe(
      "Something went wrong. Please try again. (Reference: abcdef12)"
    );
  });

  it("never shows the raw text of a non-API error", () => {
    expect(errorMessage(new Error("TypeError at /app/src/secret.ts:10"), "Failed to save")).toBe("Failed to save");
  });
});
