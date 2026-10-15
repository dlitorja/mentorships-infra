import { beforeEach, describe, expect, it } from "vitest";
import { buildAdHocCallInviteEmail } from "./ad-hoc-call";

// PR-E (Issue 5): email deep links must route through
// `/auth-redirect?redirect_url=…` so the destination survives the
// signed-out → signed-in bounce. See
// `packages/emails/src/auth-redirect-link.ts` and
// `apps/platform/app/auth-redirect/page.tsx` for the contract. Tests
// here pin that the wrapping is applied to BOTH the `text` and `html`
// versions of the join URL, and that the inner `/workspace/<id>?join=<id>`
// path is URL-encoded inside `redirect_url=` so the auth-redirect
// route handler can extract it cleanly via URLSearchParams.

describe("buildAdHocCallInviteEmail", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_URL = "https://app.huckleberry-art.dev";
  });

  // The expected `/auth-redirect?redirect_url=%2Fworkspace%2Fws_abc123%3Fjoin%3Dse_xyz789`
  // wrapper. Generated as a single source of truth so a future
  // encoding tweak (e.g. URL-encoding `+` differently) is one-edit.
  const expectedWrappedUrl =
    "https://app.huckleberry-art.dev/auth-redirect?redirect_url=%2Fworkspace%2Fws_abc123%3Fjoin%3Dse_xyz789";
  const innerPath = "/workspace/ws_abc123?join=se_xyz789";

  it("includes caller name, workspace name, and the auth-redirect-wrapped deep link when caller is instructor", () => {
    const result = buildAdHocCallInviteEmail({
      callerName: "Sarah Lee",
      callerRole: "instructor",
      workspaceName: "Acrylic Painting Mentorship",
      workspaceId: "ws_abc123",
      sessionId: "se_xyz789",
    });

    expect(result.subject).toBe("Sarah Lee started a mentorship call");
    expect(result.headers["X-Email-Type"]).toBe("ad_hoc_call_invite");

    expect(result.text).toContain("Your instructor Sarah Lee");
    expect(result.text).toContain("Acrylic Painting Mentorship");
    // PR-E: must route through /auth-redirect (not bare
    // /workspace/?join=).
    expect(result.text).toContain(expectedWrappedUrl);
    expect(result.text).not.toContain(innerPath);

    expect(result.html).toContain("Your instructor");
    expect(result.html).toContain("Sarah Lee");
    expect(result.html).toContain("Acrylic Painting Mentorship");
    // PR-E: same in html. Both `href` and the copy/paste fallback
    // must be wrapped; if either reverts to a bare `/workspace/…`
    // link, signed-out recipients lose their destination.
    expect(result.html).toContain(expectedWrappedUrl);
    expect(result.html).not.toContain(innerPath);
  });

  it("phrases the invite as 'Your student' when caller is the student", () => {
    const result = buildAdHocCallInviteEmail({
      callerName: "Marcus Reed",
      callerRole: "student",
      workspaceName: "Acrylic Painting Mentorship",
      workspaceId: "ws_abc123",
      sessionId: "se_xyz789",
    });

    expect(result.subject).toBe("Marcus Reed started a mentorship call");
    expect(result.text).toContain("Your student Marcus Reed");
    expect(result.html).toContain("Your student");
    expect(result.html).toContain("Marcus Reed");
  });

  it("escapes HTML in caller and workspace names", () => {
    const result = buildAdHocCallInviteEmail({
      callerName: "<script>alert(1)</script>",
      callerRole: "instructor",
      workspaceName: "Studio & \"Gallery\"",
      workspaceId: "ws_abc123",
      sessionId: "se_xyz789",
    });

    // Subject is plain text — does not need escaping.
    expect(result.subject).toContain("<script>alert(1)</script>");

    // HTML body must NOT contain raw script tags.
    expect(result.html).not.toContain("<script>alert(1)</script>");
    expect(result.html).toContain("&lt;script&gt;");
    expect(result.html).toContain("&amp;");
    expect(result.html).toContain("&quot;Gallery&quot;");
  });

  it("falls back to role-only copy when caller name is empty (no duplicated role wording)", () => {
    const result = buildAdHocCallInviteEmail({
      callerName: "",
      callerRole: "instructor",
      workspaceName: "Acrylic Painting Mentorship",
      workspaceId: "ws_abc123",
      sessionId: "se_xyz789",
    });

    expect(result.subject).toBe("Your instructor started a mentorship call");
    expect(result.text).toContain("Your instructor has started");
    expect(result.text).not.toContain("Your instructor Your instructor");
    expect(result.html).toContain("Your instructor has started");
    expect(result.html).not.toContain("Your instructor Your instructor");
  });

  it("treats whitespace-only caller name the same as empty", () => {
    const result = buildAdHocCallInviteEmail({
      callerName: "   ",
      callerRole: "student",
      workspaceName: "Acrylic Painting Mentorship",
      workspaceId: "ws_abc123",
      sessionId: "se_xyz789",
    });

    expect(result.subject).toBe("Your student started a mentorship call");
    expect(result.text).not.toMatch(/Your student\s+Your student/);
  });

  it("builds a deep link containing both workspaceId and sessionId", () => {
    const result = buildAdHocCallInviteEmail({
      callerName: "Sarah Lee",
      callerRole: "instructor",
      workspaceName: "Acrylic Painting Mentorship",
      workspaceId: "ws_abc123",
      sessionId: "se_xyz789",
    });

    // PR-E (Issue 5): the inner path is now URL-encoded into the
    // outer query string. Verify by decoding.
    expect(result.text).toContain(encodeURIComponent("/workspace/ws_abc123?join=se_xyz789"));
    expect(result.html).toContain(encodeURIComponent("/workspace/ws_abc123?join=se_xyz789"));
    // The outer wrapper shape must always start with the baseUrl +
    // `/auth-redirect?redirect_url=`, never with the bare path.
    expect(result.text).toMatch(/\/auth-redirect\?redirect_url=/);
    expect(result.html).toMatch(/href="https:\/\/app\.huckleberry-art\.dev\/auth-redirect\?redirect_url=/);
  });
});
