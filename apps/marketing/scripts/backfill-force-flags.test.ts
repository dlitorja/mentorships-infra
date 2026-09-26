import { describe, expect, it } from "vitest";

import { validateForceFlags } from "../../../scripts/migrate-to-convex/backfill-instructor-inventory";

describe("validateForceFlags", () => {
  it("accepts no FORCE / FORCE_ALL flags", () => {
    expect(validateForceFlags({})).toEqual({ ok: true });
  });

  it("accepts FORCE=1 alone", () => {
    expect(validateForceFlags({ FORCE: "1" })).toEqual({ ok: true });
  });

  it("accepts FORCE_ALL=1 alone", () => {
    expect(validateForceFlags({ FORCE_ALL: "1" })).toEqual({ ok: true });
  });

  it("rejects FORCE=1 and FORCE_ALL=1 together", () => {
    const result = validateForceFlags({ FORCE: "1", FORCE_ALL: "1" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(2);
    expect(result.message).toMatch(/FORCE=1 and FORCE_ALL=1/);
    expect(result.message).toMatch(/targets only the rows/);
    expect(result.message).toMatch(/destructive/);
  });

  it("ignores FORCE values other than '1'", () => {
    expect(validateForceFlags({ FORCE: "true" })).toEqual({ ok: true });
    expect(validateForceFlags({ FORCE: "yes" })).toEqual({ ok: true });
    expect(validateForceFlags({ FORCE: "" })).toEqual({ ok: true });
  });

  it("ignores FORCE_ALL values other than '1'", () => {
    expect(validateForceFlags({ FORCE_ALL: "true" })).toEqual({ ok: true });
    expect(validateForceFlags({ FORCE_ALL: "yes" })).toEqual({ ok: true });
    expect(validateForceFlags({ FORCE_ALL: "" })).toEqual({ ok: true });
  });

  it("still rejects FORCE=1 + FORCE_ALL='true' (loose FORCE_ALL does not enable the unsafe path)", () => {
    // Even if FORCE_ALL is set loosely, the only legal value is '1'.
    const result = validateForceFlags({ FORCE: "1", FORCE_ALL: "true" });
    expect(result).toEqual({ ok: true });
  });

  it("accepts ZERO_FILL_NULLS=1 alone", () => {
    expect(validateForceFlags({ ZERO_FILL_NULLS: "1" })).toEqual({ ok: true });
  });

  it("rejects ZERO_FILL_NULLS=1 + FORCE=1", () => {
    const result = validateForceFlags({ ZERO_FILL_NULLS: "1", FORCE: "1" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(2);
    expect(result.message).toMatch(/ZERO_FILL_NULLS=1 cannot be combined with FORCE=1/);
    expect(result.message).toMatch(/never overwrites a live Convex value/);
  });

  it("rejects ZERO_FILL_NULLS=1 + FORCE_ALL=1", () => {
    const result = validateForceFlags({ ZERO_FILL_NULLS: "1", FORCE_ALL: "1" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(2);
    expect(result.message).toMatch(/ZERO_FILL_NULLS=1 cannot be combined with FORCE=1 or FORCE_ALL=1/);
  });

  it("ignores ZERO_FILL_NULLS values other than '1'", () => {
    expect(validateForceFlags({ ZERO_FILL_NULLS: "true" })).toEqual({ ok: true });
    expect(validateForceFlags({ ZERO_FILL_NULLS: "yes" })).toEqual({ ok: true });
    expect(validateForceFlags({ ZERO_FILL_NULLS: "" })).toEqual({ ok: true });
  });

  // HUC-46 Phase 3 prerequisite gate (Greptile P1, PR #883 round 22).
  it("accepts VERIFY_PUBLIC_COVERAGE=1 alone", () => {
    expect(validateForceFlags({ VERIFY_PUBLIC_COVERAGE: "1" })).toEqual({ ok: true });
  });

  it("rejects VERIFY_PUBLIC_COVERAGE=1 + FORCE=1 (read-only cannot combine with writes)", () => {
    const result = validateForceFlags({
      VERIFY_PUBLIC_COVERAGE: "1",
      FORCE: "1",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(2);
    expect(result.message).toMatch(/VERIFY_PUBLIC_COVERAGE=1 is a read-only preflight/);
  });

  it("rejects VERIFY_PUBLIC_COVERAGE=1 + FORCE_ALL=1", () => {
    const result = validateForceFlags({
      VERIFY_PUBLIC_COVERAGE: "1",
      FORCE_ALL: "1",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/VERIFY_PUBLIC_COVERAGE=1/);
  });

  it("rejects VERIFY_PUBLIC_COVERAGE=1 + ZERO_FILL_NULLS=1 (preflight cannot run alongside the zero-fill pass)", () => {
    const result = validateForceFlags({
      VERIFY_PUBLIC_COVERAGE: "1",
      ZERO_FILL_NULLS: "1",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/VERIFY_PUBLIC_COVERAGE=1/);
  });

  it("ignores VERIFY_PUBLIC_COVERAGE values other than '1'", () => {
    expect(validateForceFlags({ VERIFY_PUBLIC_COVERAGE: "true" })).toEqual({ ok: true });
    expect(validateForceFlags({ VERIFY_PUBLIC_COVERAGE: "yes" })).toEqual({ ok: true });
    expect(validateForceFlags({ VERIFY_PUBLIC_COVERAGE: "" })).toEqual({ ok: true });
  });
});
