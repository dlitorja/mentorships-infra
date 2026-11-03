import { describe, expect, it } from "vitest";
import {
  buildRule,
  mergeRules,
  ruleMatches,
} from "../../scripts/set-b2-lifecycle-abort-multipart";

describe("buildRule", () => {
  it("aborts incomplete multipart uploads after 7 days", () => {
    const rule = buildRule();
    expect(rule.ID).toBe("abort-incomplete-multipart-7d");
    expect(rule.Status).toBe("Enabled");
    expect(rule.AbortIncompleteMultipartUpload).toEqual({
      DaysAfterInitiation: 7,
    });
  });

  it("never contains an Expiration block", () => {
    // The whole point of this rule: it must not be able to delete a
    // completed object. The workspace-bucket Expiration rule was
    // reverted in PR #888 round 4 for exactly this reason.
    expect(buildRule().Expiration).toBeUndefined();
    expect(buildRule().NoncurrentVersionExpiration).toBeUndefined();
  });
});

describe("mergeRules", () => {
  it("adds the rule when the bucket has none", () => {
    const merged = mergeRules([]);
    expect(merged).toHaveLength(1);
    expect(merged[0].ID).toBe("abort-incomplete-multipart-7d");
  });

  it("preserves unrelated rules instead of clobbering the configuration", () => {
    const existing = [
      { ID: "some-other-rule", Status: "Enabled" as const, Filter: { Prefix: "tmp/" } },
    ];
    const merged = mergeRules(existing);
    expect(merged.map((r) => r.ID)).toEqual([
      "abort-incomplete-multipart-7d",
      "some-other-rule",
    ]);
  });

  it("is idempotent when the rule already exists", () => {
    const once = mergeRules([]);
    const twice = mergeRules(once);
    expect(twice).toHaveLength(1);
    expect(twice[0].AbortIncompleteMultipartUpload).toEqual({
      DaysAfterInitiation: 7,
    });
  });

  it("refuses to overwrite a same-ID rule with a different abort window", () => {
    const conflicting = [
      {
        ID: "abort-incomplete-multipart-7d",
        Status: "Enabled" as const,
        Filter: { Prefix: "" },
        AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
      },
    ];
    expect(() => mergeRules(conflicting)).toThrow(/differs from the intended rule/);
  });

  it("refuses a same-ID rule scoped to a prefix", () => {
    // A `tmp/`-scoped rule leaves every other upload unhandled; matching
    // only on ID + days would have accepted it.
    const scoped = [
      {
        ID: "abort-incomplete-multipart-7d",
        Status: "Enabled" as const,
        Filter: { Prefix: "tmp/" },
        AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
      },
    ];
    expect(() => mergeRules(scoped)).toThrow(/differs from the intended rule/);
  });

  it("refuses a same-ID rule that also carries an Expiration action", () => {
    // An Expiration action would delete completed objects — the exact
    // thing this script promises never to do.
    const withExpiration = [
      {
        ID: "abort-incomplete-multipart-7d",
        Status: "Enabled" as const,
        Filter: { Prefix: "" },
        AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
        Expiration: { Days: 540 },
      },
    ];
    expect(() => mergeRules(withExpiration)).toThrow(/differs from the intended rule/);
  });
});

describe("ruleMatches", () => {
  it("accepts the intended rule", () => {
    expect(ruleMatches(buildRule())).toBe(true);
  });

  it("rejects a disabled rule", () => {
    expect(ruleMatches({ ...buildRule(), Status: "Disabled" })).toBe(false);
  });

  it("rejects a prefixed rule", () => {
    expect(ruleMatches({ ...buildRule(), Filter: { Prefix: "tmp/" } })).toBe(false);
  });

  it("rejects a rule with an Expiration action", () => {
    expect(ruleMatches({ ...buildRule(), Expiration: { Days: 30 } })).toBe(false);
  });
});
