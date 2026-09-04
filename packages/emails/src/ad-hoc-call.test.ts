import { describe, expect, it } from "vitest";
import { buildAdHocCallInviteEmail } from "./ad-hoc-call";

describe("buildAdHocCallInviteEmail", () => {
  it("includes caller name, workspace name, and a deep-link URL when caller is instructor", () => {
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
    expect(result.text).toContain(
      "/workspace/ws_abc123?join=se_xyz789"
    );

    expect(result.html).toContain("Your instructor");
    expect(result.html).toContain("Sarah Lee");
    expect(result.html).toContain("Acrylic Painting Mentorship");
    expect(result.html).toContain("/workspace/ws_abc123?join=se_xyz789");
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

  it("builds a deep link containing both workspaceId and sessionId", () => {
    const result = buildAdHocCallInviteEmail({
      callerName: "Sarah Lee",
      callerRole: "instructor",
      workspaceName: "Acrylic Painting Mentorship",
      workspaceId: "ws_abc123",
      sessionId: "se_xyz789",
    });

    expect(result.text).toMatch(/\/workspace\/ws_abc123\?join=se_xyz789/);
    expect(result.html).toMatch(/\/workspace\/ws_abc123\?join=se_xyz789/);
  });
});
