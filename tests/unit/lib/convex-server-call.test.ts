import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConvexServerCallError,
  convexServerCall,
} from "../../../apps/platform/lib/convex-server-call";

const originalEnv = { ...process.env };

describe("convexServerCall", () => {
  beforeEach(() => {
    process.env.CONVEX_URL = "https://example.convex.cloud";
    process.env.CONVEX_HTTP_KEY = "test-key-do-not-log";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("POSTs to {CONVEX_URL}{path} with bearer header and JSON body", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await convexServerCall<{ ok: boolean }>(
      "/instructors/create-for-clerk-user",
      { userId: "u_123", name: "Alex" }
    );

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(
      "https://example.convex.cloud/instructors/create-for-clerk-user"
    );
    expect(calledInit).toMatchObject({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-key-do-not-log",
      },
      body: JSON.stringify({ userId: "u_123", name: "Alex" }),
    });
  });

  it("returns parsed JSON body on 200", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ value: 42 }), { status: 200 })
    );

    const result = await convexServerCall<{ value: number }>("/users/set-role", {
      userId: "u_1",
      role: "instructor",
    });

    expect(result).toEqual({ value: 42 });
  });

  it("throws on 401 with status 502", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("unauthorized", { status: 401 })
    );

    await expect(
      convexServerCall("/users/set-role", { userId: "u_1" })
    ).rejects.toMatchObject({
      name: "ConvexServerCallError",
      status: 502,
      message: expect.stringContaining("401"),
    });
  });

  it("throws on 4xx with status 502", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("bad request: missing field", { status: 400 })
    );

    let caught: unknown = null;
    try {
      await convexServerCall("/users/set-role", { userId: "u_1" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConvexServerCallError);
    const err = caught as ConvexServerCallError;
    expect(err.status).toBe(502);
    expect(err.message).toContain("400");
    expect(err.message).toContain("bad request");
  });

  it("throws on 5xx with status 502 and includes server text", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("internal error: db down", { status: 500 })
    );

    await expect(
      convexServerCall("/users/set-role", { userId: "u_1" })
    ).rejects.toMatchObject({
      name: "ConvexServerCallError",
      status: 502,
      message: expect.stringContaining("500"),
    });
  });

  it("truncates long server error bodies", async () => {
    const longText = "x".repeat(2000);
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(longText, { status: 500 })
    );

    await expect(
      convexServerCall("/users/set-role", {})
    ).rejects.toThrowError(/x+\u2026$/);
  });

  it("throws 502 when fetch itself rejects", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await expect(
      convexServerCall("/users/set-role", {})
    ).rejects.toMatchObject({
      name: "ConvexServerCallError",
      status: 502,
      message: expect.stringContaining("Network error"),
    });
  });

  it("throws when CONVEX_URL is missing", async () => {
    delete process.env.CONVEX_URL;
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
    await expect(convexServerCall("/users/set-role", {})).rejects.toThrow(
      /CONVEX_URL/
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("falls back to NEXT_PUBLIC_CONVEX_URL and rewrites .convex.cloud to .convex.site", async () => {
    delete process.env.CONVEX_URL;
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://fallback.convex.cloud";
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    await convexServerCall("/users/set-role", {});
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      "https://fallback.convex.site/users/set-role"
    );
  });

  it("does not rewrite a NEXT_PUBLIC_CONVEX_URL that already targets .convex.site", async () => {
    delete process.env.CONVEX_URL;
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://already-site.convex.site";
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    await convexServerCall("/users/set-role", {});
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      "https://already-site.convex.site/users/set-role"
    );
  });

  it("strips trailing slashes from the resolved URL", async () => {
    process.env.CONVEX_URL = "https://example.convex.cloud/";
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    await convexServerCall("/users/set-role", {});
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      "https://example.convex.cloud/users/set-role"
    );
  });

  it("prefers CONVEX_URL over NEXT_PUBLIC_CONVEX_URL when both are set", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://fallback.convex.cloud";
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    await convexServerCall("/users/set-role", {});
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      "https://example.convex.cloud/users/set-role"
    );
  });

  it("times out with 504 when fetch aborts past the configured timeout", async () => {
    vi.mocked(fetch).mockImplementationOnce(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        })
    );

    await expect(
      convexServerCall("/users/set-role", {}, { timeoutMs: 50 })
    ).rejects.toMatchObject({
      name: "ConvexServerCallError",
      status: 504,
      message: expect.stringContaining("timed out"),
    });
  });

  it("throws when CONVEX_HTTP_KEY is missing", async () => {
    delete process.env.CONVEX_HTTP_KEY;
    await expect(convexServerCall("/users/set-role", {})).rejects.toThrow(
      /CONVEX_HTTP_KEY/
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects paths that don't start with /", async () => {
    await expect(
      convexServerCall("users/set-role", {})
    ).rejects.toThrow(/start with "\/"/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("never logs the bearer in thrown error messages", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("oops", { status: 500 })
    );

    try {
      await convexServerCall("/users/set-role", {});
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toContain("test-key-do-not-log");
      expect(message).not.toMatch(/Bearer/);
    }
  });
});
