import { describe, expect, it } from "vitest";
import { incomingCallChimeFrequencies } from "./sound";

describe("incomingCallChimeFrequencies", () => {
  it("returns ascending two-note pair (D5 then A5)", () => {
    const { first, second } = incomingCallChimeFrequencies();
    expect(first).toBeLessThan(second);
    // D5 = 587.33 Hz, A5 = 880 Hz — recognizable ding-dong
    expect(first).toBeCloseTo(587.33, 2);
    expect(second).toBe(880);
  });

  it("returns the same frequencies on every call (deterministic)", () => {
    const a = incomingCallChimeFrequencies();
    const b = incomingCallChimeFrequencies();
    expect(a).toEqual(b);
  });
});
