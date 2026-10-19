import { describe, expect, it, vi, beforeEach } from "vitest";

// `clerk-invitations.ts` throws on module load when `NODE_ENV` is not
// dev/preview and `NEXT_PUBLIC_APP_URL` is unset. `vi.stubEnv` runs at
// module-evaluation time but is hoisted like other `vi.*` calls, so it
// still applies before the deferred import below triggers module init.
vi.stubEnv("NODE_ENV", "development");
vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");

const mockGetUser = vi.fn();
const mockUpdateUserMetadata = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: () =>
    Promise.resolve({
      users: {
        getUser: (...args: unknown[]) => mockGetUser(...args),
        updateUserMetadata: (...args: unknown[]) => mockUpdateUserMetadata(...args),
      },
    }),
  // Used by createClerkInvitation / createStudentClerkInvitation in this
  // module — those return null when the API throws, so they don't need
  // auth directly in our test scope. Stub to satisfy the import.
  auth: vi.fn(),
}));

beforeEach(() => {
  mockGetUser.mockReset();
  mockUpdateUserMetadata.mockReset();
});

// Import AFTER mocks and env stubs are wired. Use a dynamic import so
// the static `import` hoisting doesn't reorder it above vi.stubEnv.
const { setInstructorPublicMetadataOnUser } = await import("./clerk-invitations");

describe("setInstructorPublicMetadataOnUser", () => {
  it("throws when userId does not start with 'user_' (placeholder guard)", async () => {
    // Placeholder userIds (`admin-${slug}`, `seed-${slug}`) must NEVER
    // be treated as Clerk-shaped. Throwing here is louder than silently
    // skipping because the caller bug (passing a placeholder) would
    // otherwise take weeks to surface.
    await expect(
      setInstructorPublicMetadataOnUser({ userId: "admin-rakasa" }),
    ).rejects.toThrow(/non-Clerk-shaped id/);

    await expect(
      setInstructorPublicMetadataOnUser({ userId: "seed-rakasa" }),
    ).rejects.toThrow(/non-Clerk-shaped id/);

    await expect(
      setInstructorPublicMetadataOnUser({ userId: "" }),
    ).rejects.toThrow(/non-Clerk-shaped id/);

    expect(mockGetUser).not.toHaveBeenCalled();
    expect(mockUpdateUserMetadata).not.toHaveBeenCalled();
  });

  it("returns { updated: false, reason: 'user-not-found' } when Clerk 404s on getUser", async () => {
    // Greptile P2: only a true 404 returns the user-not-found reason.
    // Plain errors (no status) rethrow on the next test case; this
    // case shapes the error to look like Clerk's actual SDK shape.
    const notFoundErr = Object.assign(new Error("Resource not found"), { status: 404 });
    mockGetUser.mockRejectedValueOnce(notFoundErr);

    const result = await setInstructorPublicMetadataOnUser({
      userId: "user_doesNotExist1234567",
    });

    expect(result).toEqual({ updated: false, reason: "user-not-found" });
    expect(mockUpdateUserMetadata).not.toHaveBeenCalled();
  });

  it("returns { updated: false, reason: 'already-set' } when Clerk metadata is already correct (idempotent)", async () => {
    mockGetUser.mockResolvedValueOnce({
      publicMetadata: { role: "instructor", isInstructor: true, customFlag: "keep" },
    });

    const result = await setInstructorPublicMetadataOnUser({
      userId: "user_alreadyInstructor01",
    });

    expect(result).toEqual({ updated: false, reason: "already-set" });
    expect(mockUpdateUserMetadata).not.toHaveBeenCalled();
  });

  it("writes merged publicMetadata that preserves unrelated keys (promote intent)", async () => {
    // Promote-intent variant. Models the POST create-by-adoption
    // path: we know an admin is promoting this user (the explicit
    // creation flow). The user is currently `role: "student"`
    // (adopted-by-email case); promote mode bypasses the demotion
    // short-circuit and overwrites `role` with `"instructor"`.
    // Existing unrelated keys must be preserved.
    mockGetUser.mockResolvedValueOnce({
      publicMetadata: {
        existingScalar: "keep-me",
        // Pre-existing role claim with a wrong value — must be overwritten.
        role: "student",
        isInstructor: false,
      },
    });
    mockUpdateUserMetadata.mockResolvedValueOnce({});

    const result = await setInstructorPublicMetadataOnUser({
      userId: "user_needsClaim00000000000",
      instructorId: "inst_abc123",
      intent: "promote",
    });

    expect(result).toEqual({ updated: true });
    expect(mockUpdateUserMetadata).toHaveBeenCalledTimes(1);
    const call = mockUpdateUserMetadata.mock.calls[0];
    expect(call?.[0]).toBe("user_needsClaim00000000000");
    expect(call?.[1]).toEqual({
      publicMetadata: {
        existingScalar: "keep-me",
        isInstructor: true,
        role: "instructor",
        instructorId: "inst_abc123",
      },
    });
  });

  it("does not write instructorId when not provided", async () => {
    mockGetUser.mockResolvedValueOnce({ publicMetadata: {} });
    mockUpdateUserMetadata.mockResolvedValueOnce({});

    const result = await setInstructorPublicMetadataOnUser({
      userId: "user_noInstructorId000",
    });

    expect(result).toEqual({ updated: true });
    const call = mockUpdateUserMetadata.mock.calls[0];
    expect(call?.[1]).toEqual({
      publicMetadata: {
        isInstructor: true,
        role: "instructor",
      },
    });
    // Sanity: no stray instructorId field
    expect(call?.[1]).not.toHaveProperty("publicMetadata.instructorId");
  });

  it("preserves an existing admin role — does NOT downgrade to 'instructor' (Greptile P1)", async () => {
    // An admin who enters their own email into the create-instructor
    // form is the canonical scenario — without this guard, the helper
    // would overwrite role=admin with role=instructor and lock them
    // out of /admin. Preserve the elevated role, only stamp the
    // isInstructor flag.
    mockGetUser.mockResolvedValueOnce({
      publicMetadata: { role: "admin", adminFlag: "do-not-touch" },
    });
    mockUpdateUserMetadata.mockResolvedValueOnce({});

    const result = await setInstructorPublicMetadataOnUser({
      userId: "user_adminAccidentally0000",
      instructorId: "inst_xyz",
    });

    expect(result).toEqual({ updated: true });
    const call = mockUpdateUserMetadata.mock.calls[0];
    expect(call?.[1]).toEqual({
      publicMetadata: {
        role: "admin",
        adminFlag: "do-not-touch",
        isInstructor: true,
        instructorId: "inst_xyz",
      },
    });
  });

  it("preserves elevated roles 'video_editor' and 'support' (Greptile P1 — coverage)", async () => {
    for (const elevated of ["video_editor", "support"]) {
      mockGetUser.mockResolvedValueOnce({
        publicMetadata: { role: elevated, customKey: "keep" },
      });
      mockUpdateUserMetadata.mockResolvedValueOnce({});

      const result = await setInstructorPublicMetadataOnUser({
        userId: `user_${elevated.replace("_", "")}Account01`,
      });

      expect(result.updated).toBe(true);
      const call = mockUpdateUserMetadata.mock.calls[0];
      expect(call?.[1]).toEqual({
        publicMetadata: {
          role: elevated,
          customKey: "keep",
          isInstructor: true,
        },
      });
      mockGetUser.mockReset();
      mockUpdateUserMetadata.mockReset();
    }
  });

  it("rethrows non-404 Clerk errors so callers can retry (Greptile P2)", async () => {
    // A 500 from Clerk must surface as an error — collapsing every
    // exception into "user-not-found" makes transient outages look
    // like permanent deletions.
    const transientErr = Object.assign(new Error("clerk upstream 500"), { status: 500 });
    mockGetUser.mockRejectedValueOnce(transientErr);

    await expect(
      setInstructorPublicMetadataOnUser({ userId: "user_transient00000000" }),
    ).rejects.toBe(transientErr);
    expect(mockUpdateUserMetadata).not.toHaveBeenCalled();
  });

  it("treats only true 404 as 'user-not-found' (Greptile P2 — coverage)", async () => {
    // The Clerk Backend SDK sometimes puts the status inside an
    // `errors[]` array on multi-error responses; the helper must
    // read it from either path.
    const wrapped = Object.assign(new Error("not found"), {
      errors: [{ status: 404, message: "Resource not found" }],
    });
    mockGetUser.mockRejectedValueOnce(wrapped);

    const result = await setInstructorPublicMetadataOnUser({
      userId: "user_wrappedErr00000000",
    });

    expect(result).toEqual({ updated: false, reason: "user-not-found" });
    expect(mockUpdateUserMetadata).not.toHaveBeenCalled();
  });

  it("preserves an explicit demotion in default preserve intent (Greptile P1 — third pass)", async () => {
    // An admin demoted this user back to student by setting
    // `role: "student"` and `isInstructor: false`. A routine bio
    // edit on the linked instructor record must NOT re-promote
    // them — that's exactly the loophole third-pass Greptile
    // flagged. Default intent is "preserve"; the helper short-
    // circuits with `would-clobber-demotion`.
    mockGetUser.mockResolvedValueOnce({
      publicMetadata: { role: "student", isInstructor: false, priorFlag: "keep" },
    });

    const result = await setInstructorPublicMetadataOnUser({
      userId: "user_demoted000000000",
    });

    expect(result).toEqual({ updated: false, reason: "would-clobber-demotion" });
    expect(mockUpdateUserMetadata).not.toHaveBeenCalled();
  });

  it("preserves an explicit demotion when intent is explicitly 'preserve' (coverage)", async () => {
    mockGetUser.mockResolvedValueOnce({
      publicMetadata: { role: "student", isInstructor: false },
    });

    const result = await setInstructorPublicMetadataOnUser({
      userId: "user_demotedAgain000000",
      intent: "preserve",
    });

    expect(result).toEqual({ updated: false, reason: "would-clobber-demotion" });
    expect(mockUpdateUserMetadata).not.toHaveBeenCalled();
  });

  it("promote intent BYPASSES the demotion short-circuit (admin-initiated re-elevation)", async () => {
    // An admin is manually re-activating an instructor that was
    // previously demoted (e.g., re-binding a student-role Clerk
    // user to a freshly created instructor row, or re-toggling
    // `isActive: false → true`). The caller has confirmed intent
    // to (re-)elevate; the demotion short-circuit must not apply.
    mockGetUser.mockResolvedValueOnce({
      publicMetadata: { role: "student", isInstructor: false, priorFlag: "keep" },
    });
    mockUpdateUserMetadata.mockResolvedValueOnce({});

    const result = await setInstructorPublicMetadataOnUser({
      userId: "user_reActivate0000000",
      instructorId: "inst_reActivate",
      intent: "promote",
    });

    expect(result).toEqual({ updated: true });
    expect(mockUpdateUserMetadata).toHaveBeenCalledTimes(1);
    const call = mockUpdateUserMetadata.mock.calls[0];
    expect(call?.[0]).toBe("user_reActivate0000000");
    expect(call?.[1]).toEqual({
      publicMetadata: {
        role: "instructor",
        isInstructor: true,
        priorFlag: "keep",
        instructorId: "inst_reActivate",
      },
    });
  });

  it("promote intent still respects the already-set short-circuit (idempotent on no-op case)", async () => {
    // Promote must not double-fire if the user is already fully
    // stamped. Defense-in-depth: an admin who hits the promote
    // path twice in a row shouldn't generate a redundant write.
    mockGetUser.mockResolvedValueOnce({
      publicMetadata: { role: "instructor", isInstructor: true },
    });

    const result = await setInstructorPublicMetadataOnUser({
      userId: "user_alreadyInst0000000",
      intent: "promote",
    });

    expect(result).toEqual({ updated: false, reason: "already-set" });
    expect(mockUpdateUserMetadata).not.toHaveBeenCalled();
  });

  it("promote intent self-heals desynced state (isInstructor=true, role='student') (Greptile P1 — fourth pass)", async () => {
    // An admin manually changed `role` to "student" via the Clerk
    // dashboard without clearing `isInstructor`. The shape
    // `isInstructor: true, role: "student"` is desynced. Promote
    // sites (POST, PATCH rebind, PUT re-activation) must be able
    // to repair this — the previously-too-aggressive "already-set"
    // short-circuit on `isInstructor` alone blocked promotion
    // entirely. Sign-in routing reads `role`, so the user was
    // landing on the student dashboard in spite of `isInstructor`.
    mockGetUser.mockResolvedValueOnce({
      publicMetadata: {
        isInstructor: true,
        // The desync: role disagrees with isInstructor.
        role: "student",
        priorFlag: "keep",
      },
    });
    mockUpdateUserMetadata.mockResolvedValueOnce({});

    const result = await setInstructorPublicMetadataOnUser({
      userId: "user_desynced0000000000",
      intent: "promote",
    });

    expect(result).toEqual({ updated: true });
    expect(mockUpdateUserMetadata).toHaveBeenCalledTimes(1);
    const call = mockUpdateUserMetadata.mock.calls[0];
    expect(call?.[0]).toBe("user_desynced0000000000");
    expect(call?.[1]).toEqual({
      publicMetadata: {
        isInstructor: true,
        role: "instructor",
        priorFlag: "keep",
      },
    });
  });

  it("preserve intent leaves desynced state alone (no auto-repair, Greptile P1 — fourth pass)", async () => {
    // Same desynced shape as above but in preserve mode (default).
    // The helper must NOT auto-repair without an explicit promote
    // intent — a routine bio edit that happens to read desynced
    // metadata must not silently rewrite the role. The "student"
    // demotion gate below would also catch this case (since
    // current.role === "student"), so the result is
    // "would-clobber-demotion" rather than "already-set".
    mockGetUser.mockResolvedValueOnce({
      publicMetadata: { isInstructor: true, role: "student" },
    });

    const result = await setInstructorPublicMetadataOnUser({
      userId: "user_desyncedPreserve0",
      intent: "preserve",
    });

    expect(result).toEqual({ updated: false, reason: "would-clobber-demotion" });
    expect(mockUpdateUserMetadata).not.toHaveBeenCalled();
  });
});
