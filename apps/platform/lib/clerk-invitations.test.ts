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

  it("already-set + matching instructorId short-circuits (Greptile P2 — helper side)", async () => {
    // Caller is binding (or rebinding) the existing user to the same
    // instructor row their publicMetadata.instructorId already points
    // to. Both flags AND the id match — no write needed.
    mockGetUser.mockResolvedValueOnce({
      publicMetadata: {
        role: "instructor",
        isInstructor: true,
        instructorId: "inst_xyz",
        unrelated: "keep",
      },
    });

    const result = await setInstructorPublicMetadataOnUser({
      userId: "user_matchSame00000000",
      instructorId: "inst_xyz",
    });

    expect(result).toEqual({ updated: false, reason: "already-set" });
    expect(mockUpdateUserMetadata).not.toHaveBeenCalled();
  });

  it("already-set + mismatched instructorId DOES write (corrects the stale id, Greptile P2)", async () => {
    // Caller is rebinding the existing user to a NEW instructor row
    // (or fixing a previously-bogus instructorId). Both flags are
    // stamped but the on-disk instructorId is stale. The previous
    // short-circuit ignored the caller's id, so the stale value
    // persisted on the JWT. Now the helper writes the caller's id
    // through while preserving unrelated keys.
    mockGetUser.mockResolvedValueOnce({
      publicMetadata: {
        role: "instructor",
        isInstructor: true,
        instructorId: "inst_old_or_bogus",
        unrelated: "keep",
      },
    });
    mockUpdateUserMetadata.mockResolvedValueOnce({});

    const result = await setInstructorPublicMetadataOnUser({
      userId: "user_matchStale0000000",
      instructorId: "inst_new",
    });

    expect(result).toEqual({ updated: true });
    expect(mockUpdateUserMetadata).toHaveBeenCalledTimes(1);
    const call = mockUpdateUserMetadata.mock.calls[0];
    expect(call?.[0]).toBe("user_matchStale0000000");
    expect(call?.[1]).toEqual({
      publicMetadata: {
        role: "instructor",
        isInstructor: true,
        unrelated: "keep",
        instructorId: "inst_new",
      },
    });
  });

  /**
   * Greptile P2 (sixth pass, follow-up): an admin who ALSO teaches
   * sits on `isInstructor: true, role: "admin", instructorId: "inst_xy"`.
   * The previous strict-`role === "instructor"` predicate made the
   * sync-role route re-write unchanged Clerk metadata on every page
   * mount for these users. Now the short-circuit also fires when the
   * user's role is an elevated tier, as long as the metadata is
   * functionally complete (isInstructor + matching id).
   */
  it("elevated role + matching instructorId short-circuits (admins that also teach, Greptile P2 sixth pass)", async () => {
    mockGetUser.mockResolvedValueOnce({
      publicMetadata: {
        role: "admin",
        isInstructor: true,
        instructorId: "inst_xyz",
        unrelated: "keep",
      },
    });

    const result = await setInstructorPublicMetadataOnUser({
      userId: "user_adminTeaches0000000",
      instructorId: "inst_xyz",
    });

    expect(result).toEqual({ updated: false, reason: "already-set" });
    expect(mockUpdateUserMetadata).not.toHaveBeenCalled();
  });

  it("video_editor with isInstructor + matching instructorId short-circuits (same as admin sixth pass)", async () => {
    mockGetUser.mockResolvedValueOnce({
      publicMetadata: {
        role: "video_editor",
        isInstructor: true,
        instructorId: "inst_ve",
      },
    });

    const result = await setInstructorPublicMetadataOnUser({
      userId: "user_veTeaches00000000",
      instructorId: "inst_ve",
    });

    expect(result).toEqual({ updated: false, reason: "already-set" });
    expect(mockUpdateUserMetadata).not.toHaveBeenCalled();
  });

  it("support role short-circuits when isInstructor + matching id set (sixth pass)", async () => {
    // The elevated-arm is `admin / video_editor / support` per
    // ELEVATED_ROLES, all three must short-circuit fully-stamped shape.
    mockGetUser.mockResolvedValueOnce({
      publicMetadata: {
        role: "support",
        isInstructor: true,
        instructorId: "inst_support",
      },
    });

    const result = await setInstructorPublicMetadataOnUser({
      userId: "user_supportTeach000000",
      instructorId: "inst_support",
    });

    expect(result).toEqual({ updated: false, reason: "already-set" });
    expect(mockUpdateUserMetadata).not.toHaveBeenCalled();
  });

  it("elevated role + mismatched instructorId DOES write (correction, sixth pass)", async () => {
    // Even an admin gets a fresh write when the caller rebinds them
    // to a new instructorId. The elevated role is preserved.
    mockGetUser.mockResolvedValueOnce({
      publicMetadata: {
        role: "admin",
        isInstructor: true,
        instructorId: "inst_old",
        unrelated: "keep",
      },
    });
    mockUpdateUserMetadata.mockResolvedValueOnce({});

    const result = await setInstructorPublicMetadataOnUser({
      userId: "user_adminRebind000000",
      instructorId: "inst_new",
    });

    expect(result).toEqual({ updated: true });
    expect(mockUpdateUserMetadata).toHaveBeenCalledTimes(1);
    const call = mockUpdateUserMetadata.mock.calls[0];
    expect(call?.[0]).toBe("user_adminRebind000000");
    expect(call?.[1]).toEqual({
      publicMetadata: {
        role: "admin", // elevated preserved
        isInstructor: true,
        unrelated: "keep",
        instructorId: "inst_new",
      },
    });
  });

  /**
   * Greptile P1 (twentieth pass): the previous helper did a second
   * post-write recheck + re-PATCH to mitigate the TOCTOU window
   * between getUser and updateUserMetadata. Greptile flagged that
   * the recheck's snapshot can become stale: if an admin demotes
   * the user between the recheck and the second write, the second
   * write resurrects a role the admin just removed. Resolution: do
   * NOT do a second write.
   *
   * The contract is now: exactly one PATCH per helper call when the
   * helper reaches the write path, regardless of race ordering. The
   * previous race-resilience concern (admin grants role=admin
   * between getUser and PATCH 1) is mitigated by the Clerk
   * `user.updated` webhook path driving `convex/users.ts:syncUser`
   * with `setUserRoleTrusted:enforceElevatedPreservation`. The
   * webhook path runs in a single Convex transaction and is the
   * system of record for elevated tier changes; the helper is the
   * lower-stakes instructor-stamp contract that stays single-write.
   *
   * This test asserts exactly one PATCH happens even when the
   * post-write recheck notion would have surfaced an "elevated"
   * role (we don't call recheck any more -- but the test remains as
   * a smoke contract that even if a clerical change re-introduced
   * PATCH 2 logic, it would still find this expectation failing in
   * CI rather than silently regressing the security property).
   */
  it("exactly one PATCH lands per helper call (no post-write recheck resurrect) (Greptile P1 twentieth pass)", async () => {
    // Set up the pre-write state to look "not yet stamped" so the
    // helper reaches the write path. The mocked getUser returns a
    // single shape; we never call it again from the helper now that
    // PATCH 2 is gone.
    mockGetUser.mockResolvedValueOnce({
      publicMetadata: { role: "instructor", isInstructor: false },
    });
    mockUpdateUserMetadata.mockResolvedValueOnce({});

    const result = await setInstructorPublicMetadataOnUser({
      userId: "user_onePatchOnly00000000",
    });
    expect(result.updated).toBe(true);

    // Exactly one PATCH per call. The twentieth-pass security
    // regression is "two PATCHes with PATCH 2 resurrecting a
    // removed role"; assert there is no second PATCH.
    expect(mockUpdateUserMetadata).toHaveBeenCalledTimes(1);

    const write = mockUpdateUserMetadata.mock.calls[0]?.[1] as {
      publicMetadata: Record<string, unknown>;
    };
    expect(write.publicMetadata.role).toBe("instructor");
    expect(write.publicMetadata.isInstructor).toBe(true);
  });
});
