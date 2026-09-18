import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  enrichStudentEmails,
  pickPrimaryEmail,
  type ConvexStudent,
} from "./student-enrichment";

function makeStudent(overrides: Partial<ConvexStudent> = {}): ConvexStudent {
  return {
    userId: "user_2abc123",
    email: null,
    sessionPacks: [],
    ...overrides,
  };
}

type ClerkHandler = (params: { userId: string[]; limit: number }) => Promise<{
  data: Array<{
    id: string;
    primaryEmailAddressId: string | null;
    emailAddresses: Array<{ id: string; emailAddress: string }>;
  }>;
}>;

/**
 * Builds a clerkClient factory mock whose `getUserList` mock is exposed so
 * tests can assert on the exact lookup args. The factory itself is also a
 * vi.fn so we can assert whether the client was even constructed.
 */
function makeClerkFactory(handler: ClerkHandler) {
  const getUserList = vi.fn(async (params: { userId: string[]; limit: number }) => handler(params));
  const factory = vi.fn(async () => ({
    users: { getUserList },
  }));
  return { factory, getUserList };
}

describe("pickPrimaryEmail", () => {
  it("returns the primary email address when present", () => {
    expect(
      pickPrimaryEmail("email_2", [
        { id: "email_1", emailAddress: "a@example.com" },
        { id: "email_2", emailAddress: "b@example.com" },
      ])
    ).toBe("b@example.com");
  });

  it("falls back to the first email when primary id is missing", () => {
    expect(
      pickPrimaryEmail(null, [
        { id: "email_1", emailAddress: "a@example.com" },
      ])
    ).toBe("a@example.com");
  });

  it("falls back to the first email when primary id does not match", () => {
    expect(
      pickPrimaryEmail("email_missing", [
        { id: "email_1", emailAddress: "a@example.com" },
      ])
    ).toBe("a@example.com");
  });

  it("returns null when there are no emails", () => {
    expect(pickPrimaryEmail("email_1", undefined)).toBeNull();
    expect(pickPrimaryEmail("email_1", [])).toBeNull();
  });
});

describe("enrichStudentEmails", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("returns an empty array when no students are provided", async () => {
    const { factory } = makeClerkFactory(async () => ({ data: [] }));
    const result = await enrichStudentEmails([], factory as any);
    expect(result).toEqual([]);
    expect(factory).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("keeps existing Convex emails untouched and does not call Clerk", async () => {
    const { factory, getUserList } = makeClerkFactory(async () => ({ data: [] }));
    const students = [
      makeStudent({ userId: "user_a", email: "a@example.com" }),
      makeStudent({ userId: "user_b", email: "b@example.com" }),
    ];
    const result = await enrichStudentEmails(students, factory as any);
    expect(result.map((s) => s.email)).toEqual(["a@example.com", "b@example.com"]);
    expect(getUserList).not.toHaveBeenCalled();
  });

  it("looks up missing emails in one batched Clerk call", async () => {
    const { factory, getUserList } = makeClerkFactory(async () => ({
      data: [
        { id: "user_x", primaryEmailAddressId: "e1", emailAddresses: [{ id: "e1", emailAddress: "x@example.com" }] },
        { id: "user_y", primaryEmailAddressId: "e2", emailAddresses: [{ id: "e2", emailAddress: "y@example.com" }] },
      ],
    }));
    const students = [
      makeStudent({ userId: "user_x", email: null }),
      makeStudent({ userId: "user_y", email: null }),
    ];
    const result = await enrichStudentEmails(students, factory as any);
    expect(result.map((s) => s.email)).toEqual(["x@example.com", "y@example.com"]);
    expect(getUserList).toHaveBeenCalledTimes(1);
    const call = getUserList.mock.calls[0][0];
    expect(call.userId).toEqual(["user_x", "user_y"]);
    expect(call.limit).toBe(2);
  });

  it("deduplicates Clerk lookups when the same userId appears twice", async () => {
    const { factory, getUserList } = makeClerkFactory(async () => ({
      data: [
        { id: "user_dup", primaryEmailAddressId: "e1", emailAddresses: [{ id: "e1", emailAddress: "dup@example.com" }] },
      ],
    }));
    const students = [
      makeStudent({ userId: "user_dup", email: null }),
      makeStudent({ userId: "user_dup", email: null }),
    ];
    const result = await enrichStudentEmails(students, factory as any);
    expect(result.map((s) => s.email)).toEqual(["dup@example.com", "dup@example.com"]);
    const call = getUserList.mock.calls[0][0];
    expect(call.userId).toEqual(["user_dup"]);
  });

  it("skips placeholder userIds that do not start with 'user_' to avoid wasting Clerk calls", async () => {
    const { factory, getUserList } = makeClerkFactory(async () => ({ data: [] }));
    const students = [
      makeStudent({ userId: "alice@example.com", email: null }),
      makeStudent({ userId: "legacy-12345", email: null }),
    ];
    const result = await enrichStudentEmails(students, factory as any);
    expect(result.map((s) => s.email)).toEqual([null, null]);
    expect(getUserList).not.toHaveBeenCalled();
  });

  it("treats empty-string Convex emails as missing and falls through to Clerk", async () => {
    const { factory, getUserList } = makeClerkFactory(async () => ({
      data: [
        { id: "user_blank", primaryEmailAddressId: "e1", emailAddresses: [{ id: "e1", emailAddress: "recovered@example.com" }] },
      ],
    }));
    const students = [
      makeStudent({ userId: "user_blank", email: "" }),
    ];
    const result = await enrichStudentEmails(students, factory as any);
    expect(result[0].email).toBe("recovered@example.com");
    expect(getUserList).toHaveBeenCalledTimes(1);
  });

  it("leaves email null when the user has no Clerk account and no Convex email", async () => {
    const { factory } = makeClerkFactory(async () => ({ data: [] }));
    const students = [
      makeStudent({ userId: "user_orphan", email: null }),
    ];
    const result = await enrichStudentEmails(students, factory as any);
    expect(result[0].email).toBeNull();
  });

  it("preserves session packs through the enrichment pipeline", async () => {
    const { factory } = makeClerkFactory(async () => ({
      data: [
        { id: "user_p", primaryEmailAddressId: "e1", emailAddresses: [{ id: "e1", emailAddress: "p@example.com" }] },
      ],
    }));
    const packs = [
      {
        id: "pack_1",
        instructorId: "inst_1",
        instructorName: "Inst One",
        instructorSlug: "inst-one",
        totalSessions: 4,
        remainingSessions: 2,
        purchasedAt: 1700000000000,
        expiresAt: null,
        status: "active",
      },
    ];
    const students = [makeStudent({ userId: "user_p", email: null, sessionPacks: packs })];
    const result = await enrichStudentEmails(students, factory as any);
    expect(result[0].sessionPacks).toEqual(packs);
    expect(result[0].email).toBe("p@example.com");
  });

  it("returns null and warns when the Clerk lookup throws, instead of 500'ing", async () => {
    const getUserList = vi.fn(async () => {
      throw new Error("Clerk backend unavailable");
    });
    const factory = vi.fn(async () => ({
      users: { getUserList },
    }));
    const students = [
      makeStudent({ userId: "user_x", email: null }),
    ];
    const result = await enrichStudentEmails(students, factory as any);
    expect(result[0].email).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      "[admin/students] Failed to enrich emails from Clerk:",
      expect.stringContaining("Clerk backend unavailable")
    );
  });

  it("does not call Clerk when all students already have emails", async () => {
    const { factory, getUserList } = makeClerkFactory(async () => ({ data: [] }));
    const students = [
      makeStudent({ userId: "user_a", email: "a@example.com" }),
      makeStudent({ userId: "user_b", email: "b@example.com" }),
    ];
    await enrichStudentEmails(students, factory as any);
    expect(getUserList).not.toHaveBeenCalled();
  });
});
