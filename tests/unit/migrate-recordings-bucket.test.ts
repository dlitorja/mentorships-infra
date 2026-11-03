import { describe, expect, it } from "vitest";
import { assertDistinctBuckets } from "../../scripts/migrate-recordings-bucket";

describe("assertDistinctBuckets", () => {
  it("allows different source and target buckets", () => {
    expect(() =>
      assertDistinctBuckets("instructor-uploads", "mentorship-call-storage")
    ).not.toThrow();
  });

  it("refuses a same-bucket migration", () => {
    // Both size checks would read the same object, so equal sizes would
    // not prove a second copy exists — and --apply would delete the only
    // copy of every recording.
    expect(() =>
      assertDistinctBuckets("mentorship-call-storage", "mentorship-call-storage")
    ).toThrow(/same bucket/);
  });
});
