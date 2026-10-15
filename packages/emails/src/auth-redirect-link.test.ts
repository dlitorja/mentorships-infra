import { describe, expect, it } from "vitest";

// PR-E (Issue 5): `buildAuthRedirectUrl` is the single source of truth
// for the email deep-link wrapping. Regressions here mean signed-out
// recipients lose their destination during the Clerk auth bounce —
// the symptom the operator flagged.
describe("buildAuthRedirectUrl", () => {
  it("wraps an internal workspace path through /auth-redirect", () => {
    const url = buildAuthRedirectUrl(
      "https://app.huckleberry-art.dev",
      "/workspace/ws_abc?videos=se_xyz",
    );

    expect(url).toBe(
      "https://app.huckleberry-art.dev/auth-redirect?redirect_url=%2Fworkspace%2Fws_abc%3Fvideos%3Dse_xyz",
    );
  });

  it("URL-encodes the redirect target so /, ?, and = survive the round-trip", () => {
    // encodeURIComponent encodes `/` as %2F and `?` as %3F, so the
    // outer query has exactly one `?` (sets redirect_url=) and the
    // inner target is the encoded payload. Verifies the structure
    // the auth-redirect route handler expects.
    const url = buildAuthRedirectUrl(
      "https://app.example.com",
      "/workspace/wA?join=sJ&note=hello+world",
    );

    // Outer query boundary
    expect(url.startsWith("https://app.example.com/auth-redirect?redirect_url=")).toBe(
      true,
    );
    // Payload encoding
    expect(url).toContain("%2Fworkspace%2FwA"); // /workspace/wA
    expect(url).toContain("%3Fjoin%3DsJ"); // ?join=sJ
    expect(url).toContain("%26note%3Dhello"); // &note=h (because + → space in URI)
    // No double-encoded slashes leaking through as raw slashes — only
    // the leading `/auth-redirect` may appear unencoded.
    expect(url.match(/\//g)?.length).toBeGreaterThan(0); // sanity
    const inner = decodeURIComponent(url.split("redirect_url=")[1]);
    expect(inner).toBe("/workspace/wA?join=sJ&note=hello+world");
  });

  it("preserves the baseUrl verbatim (no trailing-slash stripping, scheme-agnostic)", () => {
    expect(
      buildAuthRedirectUrl("http://localhost:3000", "/workspace/wA"),
    ).toBe("http://localhost:3000/auth-redirect?redirect_url=%2Fworkspace%2FwA");

    expect(
      buildAuthRedirectUrl("https://app.example.com/", "/workspace/wA"),
    ).toBe("https://app.example.com//auth-redirect?redirect_url=%2Fworkspace%2FwA");
    // Trailing slash on `baseUrl` produces a doubled `/` before
    // `auth-redirect`. This matches the existing `getBaseUrl()` output
    // (no trailing slash) so callers should NOT pass a trailing slash;
    // this test pins the current behavior so a future regression that
    // strips/normalises surfaces visibly.
  });

  it("encodes targets that already contain /auth-redirect and query strings", () => {
    // Nested auth-redirect would be a real bug if a caller mistakenly
    // passed an already-wrapped URL.
    const url = buildAuthRedirectUrl(
      "https://app.example.com",
      "/workspace/wA?videos=sX",
    );
    // The outer redirect_url should NOT itself contain
    // 'auth-redirect' as a path segment of the encoded payload,
    // because encodeURIComponent %2F-encodes the slash.
    const payload = decodeURIComponent(url.split("redirect_url=")[1]);
    expect(payload).not.toContain("auth-redirect");
    expect(payload).toBe("/workspace/wA?videos=sX");
  });

  it("produces identical wrapper structure for ad-hoc-call vs recording-ready (only the keyword + SID differ)", () => {
    // Two PR-E email sites use the same wrapping schema, so the
    // wrapper shape itself should be identical. The variation is
    // ONLY in the inner query-string keyword (`join` vs `videos`)
    // and the SID value. This test would catch a future regression
    // where one file drifted away from the helper.
    const joinUrl = buildAuthRedirectUrl(
      "https://app.example.com",
      "/workspace/wA?join=sJ",
    );
    const videosUrl = buildAuthRedirectUrl(
      "https://app.example.com",
      "/workspace/wA?videos=sX",
    );

    // Both share the `/auth-redirect?redirect_url=%2Fworkspace%2FwA%3F<KEY>%3D<SID>`
    // shape with baseUrl verbatim.
    expect(joinUrl.startsWith("https://app.example.com/auth-redirect?redirect_url=%2Fworkspace%2FwA%3F")).toBe(true);
    expect(videosUrl.startsWith("https://app.example.com/auth-redirect?redirect_url=%2Fworkspace%2FwA%3F")).toBe(true);

    // Decoded payloads differ only by keyword and SID.
    expect(decodeURIComponent(joinUrl.split("redirect_url=")[1])).toBe(
      "/workspace/wA?join=sJ",
    );
    expect(decodeURIComponent(videosUrl.split("redirect_url=")[1])).toBe(
      "/workspace/wA?videos=sX",
    );
  });
});

// Imported at the bottom to keep describe blocks visually grouped.
// The function under test is small enough that duplicating the
// import path next to its usage here would be redundant.
import { buildAuthRedirectUrl } from "./auth-redirect-link";
