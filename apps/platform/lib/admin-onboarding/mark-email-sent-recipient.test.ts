import { describe, expect, it } from "vitest";
import {
  emailsSentPatchForRecipient,
  type MarkEmailSentRecipient,
} from "./mark-email-sent-recipient";

// R5 (PR 14): these tests lock down the recipient→patch-shape mapping
// used by the new `markEmailSent` Convex mutation. The mapping is the
// ONLY new behavior in PR 14 (the merge logic is unchanged and is
// already covered by `emails-sent-merge.test.ts` / R7 / PR 8).
//
// The point of these tests is to catch regressions if a future PR
// edits the mapping helper — e.g. accidentally dropping
// `adminSummary: true` on the adminSummary branch, or returning
// `instructors: []` (empty array) instead of omitting the field.

describe("emailsSentPatchForRecipient", () => {
  describe("student recipient", () => {
    it("returns { student: true }", () => {
      expect(
        emailsSentPatchForRecipient({ kind: "student" }),
      ).toEqual({ student: true });
    });

    it("does not include instructors, adminSummary, or adminSummaryByEmail", () => {
      const result = emailsSentPatchForRecipient({ kind: "student" });
      expect(result).not.toHaveProperty("instructors");
      expect(result).not.toHaveProperty("adminSummary");
      expect(result).not.toHaveProperty("adminSummaryByEmail");
    });
  });

  describe("instructor recipient", () => {
    it("returns { instructors: [id] } for a single id", () => {
      expect(
        emailsSentPatchForRecipient({
          kind: "instructor",
          instructorId: "inst_123",
        }),
      ).toEqual({ instructors: ["inst_123"] });
    });

    it("preserves the instructor id exactly (no trimming, no normalization)", () => {
      const result = emailsSentPatchForRecipient({
        kind: "instructor",
        instructorId: "inst_abc_DEF-123",
      });
      expect(result.instructors).toEqual(["inst_abc_DEF-123"]);
    });

    it("does not include student, adminSummary, or adminSummaryByEmail", () => {
      const result = emailsSentPatchForRecipient({
        kind: "instructor",
        instructorId: "inst_x",
      });
      expect(result).not.toHaveProperty("student");
      expect(result).not.toHaveProperty("adminSummary");
      expect(result).not.toHaveProperty("adminSummaryByEmail");
    });

    it("returns exactly one instructor id (concat+dedupe is the caller's responsibility)", () => {
      // markEmailSent is for marking a SINGLE recipient at a time. Per-PR 4
      // semantics, instructors are marked one at a time (one timeline
      // entry per instructor id) so retries can resume from the last
      // successfully-marked instructor. The merge logic in
      // `mergeEmailsSentPatch` handles dedupe across calls; this helper
      // just returns the patch for one recipient.
      const result = emailsSentPatchForRecipient({
        kind: "instructor",
        instructorId: "inst_y",
      });
      expect(result.instructors).toHaveLength(1);
    });
  });

  describe("adminSummary recipient", () => {
    it("returns { adminSummary: true, adminSummaryByEmail: { email: true } }", () => {
      expect(
        emailsSentPatchForRecipient({
          kind: "adminSummary",
          email: "admin@example.com",
        }),
      ).toEqual({
        adminSummary: true,
        adminSummaryByEmail: { "admin@example.com": true },
      });
    });

    it("preserves the email exactly (no lowercasing, no trimming)", () => {
      const result = emailsSentPatchForRecipient({
        kind: "adminSummary",
        email: "Ops+Huckleberry@Example.COM",
      });
      expect(result.adminSummaryByEmail).toEqual({
        "Ops+Huckleberry@Example.COM": true,
      });
    });

    it("sets the adminSummary scalar AND the per-address map together", () => {
      // The adminSummary branch is the only one that sets BOTH a scalar
      // AND a per-address map. The scalar is the legacy "any admin email
      // ever sent" sentinel; the map is the per-address truth.
      const result = emailsSentPatchForRecipient({
        kind: "adminSummary",
        email: "a@b.com",
      });
      expect(result.adminSummary).toBe(true);
      expect(result.adminSummaryByEmail).toEqual({ "a@b.com": true });
    });

    it("does not include student or instructors", () => {
      const result = emailsSentPatchForRecipient({
        kind: "adminSummary",
        email: "a@b.com",
      });
      expect(result).not.toHaveProperty("student");
      expect(result).not.toHaveProperty("instructors");
    });
  });

  describe("all three kinds produce disjoint patch shapes", () => {
    // The whole point of the helper is that each recipient kind maps to
    // a UNIQUE patch shape. A regression that, say, made `student`
    // return `{ student: true, instructors: [] }` would break this
    // invariant and silently start polluting the instructors array.
    it("student patch has only student", () => {
      const keys = Object.keys(
        emailsSentPatchForRecipient({ kind: "student" }),
      ).sort();
      expect(keys).toEqual(["student"]);
    });

    it("instructor patch has only instructors", () => {
      const keys = Object.keys(
        emailsSentPatchForRecipient({
          kind: "instructor",
          instructorId: "i",
        }),
      ).sort();
      expect(keys).toEqual(["instructors"]);
    });

    it("adminSummary patch has adminSummary AND adminSummaryByEmail (no others)", () => {
      const keys = Object.keys(
        emailsSentPatchForRecipient({
          kind: "adminSummary",
          email: "a@b.com",
        }),
      ).sort();
      expect(keys).toEqual(["adminSummary", "adminSummaryByEmail"]);
    });
  });

  describe("pure-function smoke test", () => {
    it("returns a new object on each call (does not mutate shared state)", () => {
      const recipient: MarkEmailSentRecipient = { kind: "student" };
      const a = emailsSentPatchForRecipient(recipient);
      const b = emailsSentPatchForRecipient(recipient);
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });
  });
});
