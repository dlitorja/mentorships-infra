import { describe, expect, it } from "vitest";
import {
  compareItems,
  escapeCsv,
  rowsToCsv,
  sortItems,
  type SortColumn,
  type SortDirection,
} from "./index";
import type { AdminOnboardingListItem } from "../../queries/convex/use-admin-onboardings";
import type { Id } from "../../../convex/_generated/dataModel";

/**
 * Build a list-item fixture with proper Convex ID typing. Each call
 * produces a fresh id so equality-by-id in tests stays stable.
 */
let _fixtureSeq = 0;
function makeItem(overrides: Partial<AdminOnboardingListItem> = {}): AdminOnboardingListItem {
  _fixtureSeq += 1;
  return {
    _id: `fixture-${_fixtureSeq}` as Id<"adminOnboardings">,
    _creationTime: 1700000000000,
    email: "student@example.com",
    source: "kajabi",
    status: "queued",
    failureReason: undefined,
    attemptCount: 1,
    flowVersion: 1,
    submittedByUserId: "admin_1",
    perInstructor: [],
    createdAt: 1700000000000,
    completedAt: undefined,
    cancelledAt: undefined,
    instructorNames: [],
    ...overrides,
  };
}

describe("compareItems", () => {
  it("createdAt desc puts newest first", () => {
    const a = makeItem({ createdAt: 1000 });
    const b = makeItem({ createdAt: 2000 });
    expect(compareItems(a, b, "createdAt", "desc")).toBeGreaterThan(0);
    expect(compareItems(b, a, "createdAt", "desc")).toBeLessThan(0);
  });

  it("createdAt asc puts oldest first", () => {
    const a = makeItem({ createdAt: 1000 });
    const b = makeItem({ createdAt: 2000 });
    expect(compareItems(a, b, "createdAt", "asc")).toBeLessThan(0);
    expect(compareItems(b, a, "createdAt", "asc")).toBeGreaterThan(0);
  });

  it("attemptCount desc puts highest first", () => {
    const a = makeItem({ attemptCount: 1 });
    const b = makeItem({ attemptCount: 5 });
    expect(compareItems(a, b, "attemptCount", "desc")).toBeGreaterThan(0);
  });

  it("attemptCount asc puts lowest first", () => {
    const a = makeItem({ attemptCount: 1 });
    const b = makeItem({ attemptCount: 5 });
    expect(compareItems(a, b, "attemptCount", "asc")).toBeLessThan(0);
  });

  it("status sorts alphabetically on the user-facing label", () => {
    const queued = makeItem({ status: "queued" });
    const completed = makeItem({ status: "completed" });
    const failed = makeItem({ status: "failed" });
    const sorted = [queued, completed, failed].sort((a, b) =>
      compareItems(a, b, "status", "asc")
    );
    // statusLabel mapping: completed -> "Completed", failed -> "Needs attention",
    // queued -> "Pending signup". Alphabetical on those labels.
    expect(sorted.map((s) => s.status)).toEqual(["completed", "failed", "queued"]);
  });
});

describe("sortItems", () => {
  it("returns a new sorted array without mutating the input", () => {
    const input = [
      makeItem({ createdAt: 1000 }),
      makeItem({ createdAt: 3000 }),
      makeItem({ createdAt: 2000 }),
    ];
    const originalOrder = input.map((i) => i._id);
    const sorted = sortItems(input, "createdAt", "desc");
    expect(sorted.map((i) => i._id)).toEqual([
      input[1]._id,
      input[2]._id,
      input[0]._id,
    ]);
    expect(input.map((i) => i._id)).toEqual(originalOrder);
  });

  it("returns empty array unchanged", () => {
    expect(sortItems([], "createdAt", "asc")).toEqual([]);
  });

  const columns: SortColumn[] = ["createdAt", "status", "attemptCount"];
  const directions: SortDirection[] = ["asc", "desc"];
  it.each(
    columns.flatMap((c) => directions.map((d) => [c, d] as [SortColumn, SortDirection]))
  )("handles %s/%s without throwing", (c, d) => {
    expect(() =>
      sortItems(
        [
          makeItem({ createdAt: 1000, attemptCount: 2, status: "queued" }),
          makeItem({ createdAt: 2000, attemptCount: 1, status: "completed" }),
        ],
        c,
        d
      )
    ).not.toThrow();
  });
});

describe("escapeCsv", () => {
  it("returns plain string untouched when no special chars", () => {
    expect(escapeCsv("hello world")).toBe("hello world");
    expect(escapeCsv("test@example.com")).toBe("test@example.com");
  });

  it("wraps in quotes when value contains a comma", () => {
    expect(escapeCsv("a,b")).toBe('"a,b"');
  });

  it("wraps in quotes when value contains a double quote, doubling inner quotes", () => {
    expect(escapeCsv('she said "hi"')).toBe('"she said ""hi"""');
  });

  it("wraps in quotes when value contains a newline", () => {
    expect(escapeCsv("line1\nline2")).toBe('"line1\nline2"');
  });

  it("wraps in quotes when value contains a carriage return", () => {
    expect(escapeCsv("line1\rline2")).toBe('"line1\rline2"');
  });
});

describe("rowsToCsv", () => {
  it("emits the header row", () => {
    const csv = rowsToCsv([]);
    expect(csv).toBe("Submitted,Email,Source,Instructors,InstructorNames,Status,Attempts,Failure");
  });

  it("emits a row with all fields populated", () => {
    const item = makeItem({
      email: "student@example.com",
      source: "kajabi",
      status: "completed",
      attemptCount: 2,
      createdAt: 1700000000000,
      failureReason: undefined,
      perInstructor: [
        {
          instructorId: "i1" as any,
          isRenewal: true,
          sessionsPerInstructor: 4,
        },
        {
          instructorId: "i2" as any,
          isRenewal: false,
          sessionsPerInstructor: 4,
        },
      ],
      instructorNames: ["Alice Smith", "Bob Jones"],
    });
    const csv = rowsToCsv([item]);
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(
      `2023-11-14T22:13:20.000Z,student@example.com,kajabi,2 (1 renewal),Alice Smith; Bob Jones,Completed,2,`
    );
  });

  it("escapes commas and quotes in failureReason", () => {
    const item = makeItem({
      status: "failed",
      failureReason: 'Resend: "address not found", retrying',
    });
    const csv = rowsToCsv([item]);
    const row = csv.split("\r\n")[1];
    expect(row.endsWith('"Resend: ""address not found"", retrying"')).toBe(true);
  });

  it("handles missing instructorNames gracefully", () => {
    const item = makeItem({
      status: "queued",
      perInstructor: [],
      instructorNames: [],
    });
    const csv = rowsToCsv([item]);
    expect(csv).toContain("0 (0 renewal),,Pending signup,");
  });

  it("uses CRLF line endings (RFC 4180)", () => {
    const csv = rowsToCsv([makeItem(), makeItem()]);
    expect(csv.split("\r\n")).toHaveLength(3);
    // No bare \n without \r
    expect((csv.match(/(?<!\r)\n/g) ?? []).length).toBe(0);
  });

  it("neutralizes CSV formula injection on user-controlled fields", () => {
    const csv = rowsToCsv([
      makeItem({
        email: "=cmd|' /C calc'!A1",
        status: "failed",
        failureReason: "+SUM(A1:A10)",
        instructorNames: ["-malicious", "@evil"],
      }),
    ]);
    const row = csv.split("\r\n")[1];
    // All four injected formula prefixes must be neutralized with `'`
    expect(row).toContain("'=cmd|' /C calc'!A1");
    expect(row).toContain("'+SUM(A1:A10)");
    expect(row).toContain("'-malicious");
    expect(row).toContain("'@evil");
  });

  it("does not prefix plain text values with apostrophe", () => {
    expect(escapeCsv("alice@example.com")).toBe("alice@example.com");
    expect(escapeCsv("Resend error")).toBe("Resend error");
  });
});
