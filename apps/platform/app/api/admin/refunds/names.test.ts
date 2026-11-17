import { describe, expect, it } from "vitest";
import { pickInstructorName } from "./route";

/**
 * A refund receipt that names the wrong instructor is worse than one that says
 * "your instructor". The pack behind a payment is not resolvable from the order,
 * so only unambiguous cases may commit to a name.
 */
describe("pickInstructorName", () => {
  it("uses the single instructor across the student's packs", () => {
    expect(pickInstructorName(["Ada", "Ada", null])).toBe("Ada");
  });

  it("falls back when the student has more than one instructor", () => {
    expect(pickInstructorName(["Ada", "Grace"])).toBe("your instructor");
  });

  it("falls back when no name is known", () => {
    expect(pickInstructorName([null, undefined, "  "])).toBe("your instructor");
    expect(pickInstructorName([])).toBe("your instructor");
  });
});
