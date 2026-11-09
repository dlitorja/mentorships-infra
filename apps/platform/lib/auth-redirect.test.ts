import { describe, expect, it } from "vitest";

import { shouldHonorRequestedDestination } from "@/lib/auth-redirect";

describe("shouldHonorRequestedDestination", () => {
  it("returns false when no destination was requested", () => {
    expect(shouldHonorRequestedDestination("student", null)).toBe(false);
    expect(shouldHonorRequestedDestination("instructor", null)).toBe(false);
  });

  it("lets students return to onboarding questionnaires", () => {
    expect(
      shouldHonorRequestedDestination(
        "student",
        "/onboarding/abc/questionnaire"
      )
    ).toBe(true);
  });

  it("lets every role return to a workspace (call / recording deep links)", () => {
    for (const role of ["student", "instructor", "admin", "support"]) {
      expect(
        shouldHonorRequestedDestination(role, "/workspace/ws_1?join=sess_1")
      ).toBe(true);
    }
  });

  it("does not send staff to student onboarding surfaces", () => {
    for (const role of ["instructor", "admin", "support"]) {
      expect(
        shouldHonorRequestedDestination(role, "/onboarding/abc/questionnaire")
      ).toBe(false);
    }
  });

  it("rejects protocol-relative and traversal-shaped destinations", () => {
    expect(
      shouldHonorRequestedDestination("student", "//evil.example.com")
    ).toBe(false);
    expect(
      shouldHonorRequestedDestination("student", "/workspace/../admin")
    ).toBe(false);
  });
});
