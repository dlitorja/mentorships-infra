import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeBaseUrl, requireBaseUrl } from "./base-url";
import { getBaseUrl } from "./send";

// Regression coverage for the production incident where
// `NEXT_PUBLIC_URL="[SENSITIVE]"` (this repo's redacted `.env.local`
// template) was synced into the Trigger.dev project by a local deploy.
// `getBaseUrl()` returned it verbatim, so every email built a
// `[SENSITIVE]/auth-redirect?redirect_url=…` link that could not be
// clicked. These tests pin the validation that replaces the passthrough.

describe("normalizeBaseUrl", () => {
  it("accepts an absolute https origin", () => {
    expect(normalizeBaseUrl("https://dev.mentorships.huckleberry.art")).toBe(
      "https://dev.mentorships.huckleberry.art",
    );
  });

  it("strips trailing slashes so links never contain a double slash", () => {
    expect(normalizeBaseUrl("https://dev.mentorships.huckleberry.art/")).toBe(
      "https://dev.mentorships.huckleberry.art",
    );
    expect(normalizeBaseUrl("https://dev.mentorships.huckleberry.art///")).toBe(
      "https://dev.mentorships.huckleberry.art",
    );
  });

  it("keeps a path prefix and trims its trailing slash", () => {
    expect(normalizeBaseUrl("http://localhost:3000/app/")).toBe(
      "http://localhost:3000/app",
    );
  });

  it("tolerates surrounding whitespace", () => {
    expect(normalizeBaseUrl("  https://example.com  ")).toBe("https://example.com");
  });

  // The actual production value.
  it("rejects the redacted [SENSITIVE] placeholder", () => {
    expect(normalizeBaseUrl("[SENSITIVE]")).toBeNull();
    expect(normalizeBaseUrl("  [sensitive]  ")).toBeNull();
  });

  it("rejects other placeholder sentinels", () => {
    expect(normalizeBaseUrl("placeholder")).toBeNull();
    expect(normalizeBaseUrl("changeme")).toBeNull();
  });

  it("rejects a bare host with no scheme", () => {
    expect(normalizeBaseUrl("example.com")).toBeNull();
    expect(normalizeBaseUrl("localhost:3000")).toBeNull();
  });

  it("rejects non-http(s) schemes", () => {
    expect(normalizeBaseUrl("ftp://example.com")).toBeNull();
    expect(normalizeBaseUrl("javascript:alert(1)")).toBeNull();
  });

  it("rejects values with no host", () => {
    // `new URL("https://")` throws; the WHATWG parser treats
    // `http:///path` as host `path`, which is a host, so it is not
    // rejected here.
    expect(normalizeBaseUrl("https://")).toBeNull();
    expect(normalizeBaseUrl("https://?x=1")).toBeNull();
  });

  it("rejects a query, fragment, or credentials", () => {
    expect(normalizeBaseUrl("https://example.com?x=1")).toBeNull();
    expect(normalizeBaseUrl("https://example.com#frag")).toBeNull();
    expect(normalizeBaseUrl("https://user:pass@example.com")).toBeNull();
  });

  it("rejects empty and non-string values", () => {
    expect(normalizeBaseUrl("")).toBeNull();
    expect(normalizeBaseUrl("   ")).toBeNull();
    expect(normalizeBaseUrl(undefined)).toBeNull();
    expect(normalizeBaseUrl(null)).toBeNull();
  });
});

describe("requireBaseUrl", () => {
  it("returns the normalized value", () => {
    expect(requireBaseUrl("https://example.com/", "NEXT_PUBLIC_URL")).toBe(
      "https://example.com",
    );
  });

  it("names the offending value and variable in the error", () => {
    expect(() => requireBaseUrl("[SENSITIVE]", "NEXT_PUBLIC_URL")).toThrowError(
      /Invalid email base URL for NEXT_PUBLIC_URL.*\[SENSITIVE\]/s,
    );
  });

  it("explains how to fix a missing value", () => {
    expect(() => requireBaseUrl(undefined, "NEXT_PUBLIC_URL")).toThrowError(
      /undefined.*dev\.mentorships\.huckleberry\.art/s,
    );
  });
});

describe("getBaseUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("normalizes NEXT_PUBLIC_URL", () => {
    vi.stubEnv("NEXT_PUBLIC_URL", "https://dev.mentorships.huckleberry.art/");
    vi.stubEnv("VERCEL_URL", "");
    expect(getBaseUrl()).toBe("https://dev.mentorships.huckleberry.art");
  });

  // Fail-loudly contract: an unusable value must never be returned,
  // because callers interpolate it straight into email links.
  it("throws instead of returning a redacted placeholder", () => {
    vi.stubEnv("NEXT_PUBLIC_URL", "[SENSITIVE]");
    expect(() => getBaseUrl()).toThrowError(/Invalid email base URL/);
  });

  it("falls back to VERCEL_URL when NEXT_PUBLIC_URL is unset", () => {
    vi.stubEnv("NEXT_PUBLIC_URL", "");
    vi.stubEnv("VERCEL_URL", "mentorships-preview.vercel.app");
    expect(getBaseUrl()).toBe("https://mentorships-preview.vercel.app");
  });

  it("returns the local origin outside production when nothing is set", () => {
    vi.stubEnv("NEXT_PUBLIC_URL", "");
    vi.stubEnv("VERCEL_URL", "");
    expect(getBaseUrl()).toBe("http://localhost:3000");
  });
});
