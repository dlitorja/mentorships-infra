import { afterEach, describe, expect, test, vi } from "vitest";
import { resolveApiRequestUrl } from "@/lib/queries/api-client";

/**
 * `apiFetch("/api/…")` works in the browser and throws
 * `TypeError: Failed to parse URL` anywhere else. The dashboard hit this on
 * every render while its sections used `useSuspenseQuery` (which fetches during
 * server render). These tests pin both halves: the browser keeps relative URLs,
 * and a non-browser caller gets an absolute one or an actionable error.
 */

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
  // jsdom has a window; restore it after tests that delete it.
  if (typeof globalThis.window === "undefined") {
    globalThis.window = globalThis as unknown as Window & typeof globalThis;
  }
});

function simulateServer() {
  // `typeof window === "undefined"` is what the resolver checks.
  vi.stubGlobal("window", undefined);
}

describe("resolveApiRequestUrl", () => {
  test("keeps relative URLs in the browser", () => {
    expect(resolveApiRequestUrl("/api/admin/stats")).toBe("/api/admin/stats");
  });

  test("leaves absolute URLs alone in any runtime", () => {
    simulateServer();
    expect(resolveApiRequestUrl("https://example.com/api/x")).toBe(
      "https://example.com/api/x"
    );
  });

  test("prefixes the configured app URL outside the browser", () => {
    simulateServer();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://dev.example.com");

    expect(resolveApiRequestUrl("/api/admin/stats")).toBe(
      "https://dev.example.com/api/admin/stats"
    );
  });

  test("falls back to NEXT_PUBLIC_URL, then VERCEL_URL", () => {
    simulateServer();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("NEXT_PUBLIC_URL", "https://from-public-url.example.com");
    expect(resolveApiRequestUrl("/api/x")).toBe(
      "https://from-public-url.example.com/api/x"
    );

    vi.stubEnv("NEXT_PUBLIC_URL", "");
    vi.stubEnv("VERCEL_URL", "prj-abc.vercel.app");
    expect(resolveApiRequestUrl("/api/x")).toBe("https://prj-abc.vercel.app/api/x");
  });

  test("ignores the redacted placeholder this repo's .env template uses", () => {
    simulateServer();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "[SENSITIVE]");
    vi.stubEnv("NEXT_PUBLIC_URL", "http://localhost:3000");

    expect(resolveApiRequestUrl("/api/x")).toBe("http://localhost:3000/api/x");
  });

  test("adds the leading slash when a caller omits it", () => {
    simulateServer();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://dev.example.com/");

    expect(resolveApiRequestUrl("api/x")).toBe("https://dev.example.com/api/x");
  });

  test("throws an actionable error when no base is configured", () => {
    simulateServer();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("NEXT_PUBLIC_URL", "");
    vi.stubEnv("VERCEL_URL", "");

    expect(() => resolveApiRequestUrl("/api/admin/stats")).toThrow(
      /NEXT_PUBLIC_APP_URL/
    );
  });
});
