import { describe, expect, it } from "vitest";
import { sameIdSet } from "./workspace-export-selection";

describe("sameIdSet", () => {
  it("treats order as irrelevant", () => {
    expect(sameIdSet(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameIdSet(["a", "b"], new Set(["b", "a"]))).toBe(true);
  });

  it("is false when the stored set is missing or empty", () => {
    expect(sameIdSet(undefined, ["a"])).toBe(false);
    expect(sameIdSet([], ["a"])).toBe(false);
    expect(sameIdSet([], [])).toBe(false);
  });

  it("is false when the sets differ", () => {
    expect(sameIdSet(["a"], ["a", "b"])).toBe(false);
    expect(sameIdSet(["a", "b"], ["a", "c"])).toBe(false);
    expect(sameIdSet(["a", "b"], ["a"])).toBe(false);
  });
});
