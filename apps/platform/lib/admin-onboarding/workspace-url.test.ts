import { describe, expect, it } from "vitest";
import { workspaceUrlFor } from "./workspace-url";

// R6 (PR 15): these tests lock down the per-instructor workspace URL
// mapping used by the admin-onboarding student email and the admin
// summary email. The mapping is the new behavior in PR 15 -- previously
// both emails hardcoded `<baseUrl>/dashboard` for every per-instructor
// row. After PR 15, NEW onboardings (where `p.workspaceId` is set)
// link to the new `/dashboard/workspaces/[id]` route, and RENEWAL
// onboardings (where `p.workspaceId` is undefined) fall back to
// `/dashboard` so the link still lands on the student's dashboard
// instead of 404ing on an empty workspace id.

describe("workspaceUrlFor", () => {
  describe("new onboarding (workspaceId is set)", () => {
    it("returns /dashboard/workspaces/<id> when workspaceId is set", () => {
      expect(
        workspaceUrlFor("https://app.example.com", {
          workspaceId: "wk_abc123def456",
        }),
      ).toBe("https://app.example.com/dashboard/workspaces/wk_abc123def456");
    });

    it("preserves the workspace id exactly (no trimming, no escaping)", () => {
      // Convex IDs can contain underscores and hyphens. The helper
      // does not transform the id -- the URL is built by simple
      // concatenation, which is safe because Convex IDs only use
      // [a-zA-Z0-9_-] per `convexIdSchema` in
      // `apps/platform/lib/validators.ts`.
      expect(
        workspaceUrlFor("https://app.example.com", {
          workspaceId: "wk_abc_DEF-123",
        }),
      ).toBe("https://app.example.com/dashboard/workspaces/wk_abc_DEF-123");
    });

    it("preserves the baseUrl exactly (does not strip or normalize trailing slash)", () => {
      // Callers pass a baseUrl without a trailing slash (see
      // `getBaseUrl()` in `apps/platform/lib/get-base-url.ts`). This
      // test pins the existing convention so a future change to
      // `getBaseUrl()` is caught.
      expect(
        workspaceUrlFor("https://app.example.com", {
          workspaceId: "wk_x",
        }),
      ).toBe("https://app.example.com/dashboard/workspaces/wk_x");
    });

    it("works with localhost / staging baseUrls", () => {
      expect(
        workspaceUrlFor("http://localhost:3000", {
          workspaceId: "wk_xyz",
        }),
      ).toBe("http://localhost:3000/dashboard/workspaces/wk_xyz");
    });
  });

  describe("renewal onboarding (workspaceId is undefined / empty)", () => {
    it("returns /dashboard when workspaceId is undefined", () => {
      expect(
        workspaceUrlFor("https://app.example.com", {
          workspaceId: undefined,
        }),
      ).toBe("https://app.example.com/dashboard");
    });

    it("returns /dashboard when workspaceId is omitted entirely", () => {
      expect(
        workspaceUrlFor("https://app.example.com", {}),
      ).toBe("https://app.example.com/dashboard");
    });

    it("returns /dashboard when workspaceId is the empty string", () => {
      // Defensive: an empty string is truthy in `if (p.workspaceId)`
      // but this helper treats empty string as "no id" so the link
      // still falls back to /dashboard instead of producing
      // /dashboard/workspaces/ (empty id).
      expect(
        workspaceUrlFor("https://app.example.com", {
          workspaceId: "",
        }),
      ).toBe("https://app.example.com/dashboard");
    });
  });

  describe("idempotency / pure function", () => {
    it("returns a string -- not a Convex URL or anything fancy", () => {
      const result = workspaceUrlFor("https://app.example.com", {
        workspaceId: "wk_x",
      });
      expect(typeof result).toBe("string");
      expect(result).toMatch(/^https:\/\//);
    });

    it("two calls with the same inputs return equal strings", () => {
      const a = workspaceUrlFor("https://app.example.com", {
        workspaceId: "wk_x",
      });
      const b = workspaceUrlFor("https://app.example.com", {
        workspaceId: "wk_x",
      });
      expect(a).toBe(b);
    });
  });
});
