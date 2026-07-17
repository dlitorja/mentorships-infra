import { describe, expect, it } from "vitest";
import {
  mergeEmailsSentPatch,
  type EmailsSentPatch,
  type EmailsSentState,
} from "./emails-sent-merge";

// R7 (PR 8): these tests lock down the invariants added in PR 4 that
// protect against re-sending emails on retry:
//   1. `instructors` arrays are concatenated + deduplicated.
//   2. `adminSummaryByEmail` is keyed-merged (last patch wins on collision).
//   3. Other top-level scalars (`student`, `adminSummary`, `stub`)
//      follow a shallow patch (last patch wins).
//
// The helper mirrors the inline merge that used to live in
// `convex/adminOnboarding.ts:appendTimelineEntry` so the behavior is
// preserved when the inline merge is replaced.

function instructors(ids: readonly string[]): EmailsSentState {
  return { instructors: ids };
}

function patch(overrides: Partial<EmailsSentPatch> = {}): EmailsSentPatch {
  return { ...overrides };
}

describe("mergeEmailsSentPatch", () => {
  describe("null / undefined inputs", () => {
    it("returns an empty object when both sides are empty", () => {
      expect(mergeEmailsSentPatch(null, null)).toEqual({});
      expect(mergeEmailsSentPatch(undefined, undefined)).toEqual({});
      expect(mergeEmailsSentPatch(null, undefined)).toEqual({});
    });

    it("returns the existing state unchanged when patch is null/undefined", () => {
      const existing: EmailsSentState = {
        student: true,
        instructors: ["a", "b"],
        adminSummaryByEmail: { "x@y.com": true },
      };
      expect(mergeEmailsSentPatch(existing, null)).toBe(existing);
      expect(mergeEmailsSentPatch(existing, undefined)).toBe(existing);
    });

    it("returns a patch-only state when existing is null/undefined", () => {
      const patchOnly: EmailsSentPatch = {
        student: true,
        instructors: ["a"],
        adminSummaryByEmail: { "x@y.com": false },
      };
      expect(mergeEmailsSentPatch(null, patchOnly)).toEqual({
        student: true,
        instructors: ["a"],
        adminSummaryByEmail: { "x@y.com": false },
      });
      expect(mergeEmailsSentPatch(undefined, patchOnly)).toEqual({
        student: true,
        instructors: ["a"],
        adminSummaryByEmail: { "x@y.com": false },
      });
    });
  });

  describe("instructor id deduplication", () => {
    it("concatenates disjoint instructor ids", () => {
      expect(
        mergeEmailsSentPatch(
          instructors(["a", "b"]),
          patch({ instructors: ["c"] }),
        ),
      ).toEqual({
        instructors: ["a", "b", "c"],
        adminSummaryByEmail: {},
      });
    });

    it("deduplicates overlapping instructor ids while preserving order", () => {
      expect(
        mergeEmailsSentPatch(
          instructors(["a", "b", "c"]),
          patch({ instructors: ["b", "d", "a", "e"] }),
        ),
      ).toEqual({
        instructors: ["a", "b", "c", "d", "e"],
        adminSummaryByEmail: {},
      });
    });

    it("treats patch-only instructors as the initial list", () => {
      expect(
        mergeEmailsSentPatch(null, patch({ instructors: ["x"] })),
      ).toEqual({
        instructors: ["x"],
        adminSummaryByEmail: {},
      });
    });

    it("does not mutate the source arrays on either side", () => {
      const existingArr = ["a", "b"];
      const patchArr = ["b", "c"];
      const existing: EmailsSentState = { instructors: existingArr };
      const patchObj: EmailsSentPatch = { instructors: patchArr };
      const result = mergeEmailsSentPatch(existing, patchObj);
      expect(result.instructors).toEqual(["a", "b", "c"]);
      expect(existingArr).toEqual(["a", "b"]);
      expect(patchArr).toEqual(["b", "c"]);
    });
  });

  describe("adminSummaryByEmail keyed merge", () => {
    it("merges disjoint keys", () => {
      expect(
        mergeEmailsSentPatch(
          { adminSummaryByEmail: { "a@x.com": true } },
          patch({ adminSummaryByEmail: { "b@x.com": true } }),
        ),
      ).toEqual({
        instructors: [],
        adminSummaryByEmail: { "a@x.com": true, "b@x.com": true },
      });
    });

    it("lets the patch win on key collisions", () => {
      expect(
        mergeEmailsSentPatch(
          { adminSummaryByEmail: { "a@x.com": true, "b@x.com": true } },
          patch({ adminSummaryByEmail: { "a@x.com": false } }),
        ),
      ).toEqual({
        instructors: [],
        adminSummaryByEmail: { "a@x.com": false, "b@x.com": true },
      });
    });

    it("survives an empty existing map", () => {
      expect(
        mergeEmailsSentPatch(
          { adminSummaryByEmail: {} },
          patch({ adminSummaryByEmail: { "a@x.com": true } }),
        ),
      ).toEqual({
        instructors: [],
        adminSummaryByEmail: { "a@x.com": true },
      });
    });

    it("returns an empty map when both sides are empty", () => {
      expect(
        mergeEmailsSentPatch(
          { adminSummaryByEmail: {} },
          patch({ adminSummaryByEmail: {} }),
        ),
      ).toEqual({
        instructors: [],
        adminSummaryByEmail: {},
      });
    });
  });

  describe("top-level scalar fields", () => {
    it("lets the patch's `student` boolean win", () => {
      expect(
        mergeEmailsSentPatch({ student: false }, patch({ student: true })),
      ).toEqual({
        student: true,
        instructors: [],
        adminSummaryByEmail: {},
      });
    });

    it("lets the patch's `adminSummary` boolean win", () => {
      expect(
        mergeEmailsSentPatch(
          { adminSummary: false },
          patch({ adminSummary: true }),
        ),
      ).toEqual({
        adminSummary: true,
        instructors: [],
        adminSummaryByEmail: {},
      });
    });

    it("lets the patch's `stub` boolean win", () => {
      expect(
        mergeEmailsSentPatch({ stub: false }, patch({ stub: true })),
      ).toEqual({
        stub: true,
        instructors: [],
        adminSummaryByEmail: {},
      });
    });

    it("keeps the existing scalar when the patch omits it", () => {
      expect(
        mergeEmailsSentPatch(
          { student: true, adminSummary: true, stub: true },
          patch({ instructors: ["a"] }),
        ),
      ).toEqual({
        student: true,
        adminSummary: true,
        stub: true,
        instructors: ["a"],
        adminSummaryByEmail: {},
      });
    });
  });

  describe("realistic tick pattern", () => {
    it("accumulates state across a student tick + per-instructor ticks + admin summary", () => {
      // Tick 1: student email
      let state = mergeEmailsSentPatch(undefined, {
        student: true,
      });
      // Tick 2: first instructor
      state = mergeEmailsSentPatch(state, {
        instructors: ["inst_1"],
      });
      // Tick 3: second instructor
      state = mergeEmailsSentPatch(state, {
        instructors: ["inst_2", "inst_1"], // overlap with previous tick
      });
      // Tick 4: admin summary to two addresses, retry of one
      state = mergeEmailsSentPatch(state, {
        adminSummary: true,
        adminSummaryByEmail: {
          "ops@example.com": true,
          "ceo@example.com": false,
        },
      });
      // Tick 5: retry admin summary to ceo only — prior state preserved
      state = mergeEmailsSentPatch(state, {
        adminSummaryByEmail: { "ceo@example.com": true },
      });

      expect(state).toEqual({
        student: true,
        instructors: ["inst_1", "inst_2"],
        adminSummary: true,
        adminSummaryByEmail: {
          "ops@example.com": true,
          "ceo@example.com": true,
        },
      });
    });
  });
});
