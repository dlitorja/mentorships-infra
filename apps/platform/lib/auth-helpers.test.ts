import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the server-side Clerk module so we control what `auth()` and
// `clerkClient()` return on each call. The setup.tsx in tests/unit mocks the
// client-side `@clerk/nextjs` module, but the server-side export path is
// separate (`@clerk/nextjs/server`).
const mockAuth = vi.fn();
const mockClerkClient = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  auth: () => mockAuth(),
  clerkClient: () => mockClerkClient(),
}));

// Mock `convex/nextjs`'s `fetchQuery` so the DB fallback path can be
// exercised without spinning up a real Convex deployment.
const mockFetchQuery = vi.fn();
vi.mock("convex/nextjs", () => ({
  fetchQuery: (...args: unknown[]) => mockFetchQuery(...args),
}));

// Mock the generated API. The fallback uses
// `api.instructors.getCurrentInstructor`; we just need a stable identity.
// `api.admin.getMyRole` is the new authoritative admin role check (the
// "Convex-wins" pattern) — stubbed so the helper can call it without
// hitting the network.
vi.mock("@/convex/_generated/api", () => ({
  api: {
    instructors: {
      getCurrentInstructor: "instructors.getCurrentInstructor",
    },
    admin: {
      getMyRole: "admin.getMyRole",
    },
  },
}));

// Mock observability so the warning paths can be exercised without flooding
// the test console.
const mockReportError = vi.fn();
vi.mock("@/lib/observability", () => ({
  reportError: (...args: unknown[]) => mockReportError(...args),
}));

// Import AFTER mocks are wired.
import {
  getConvexAuthToken,
  getServerUserRole,
  requireAuth,
  requireRole,
  requireRoleForApi,
  requireAdminOrSupportForApi,
} from "./auth-helpers";
import { ForbiddenError, UnauthorizedError } from "./errors";

type AuthOverrides = {
  userId: string | null;
  publicMetadataRole?: unknown;
  getToken?: string | null;
};

function setAuth(overrides: AuthOverrides) {
  mockAuth.mockResolvedValue({
    userId: overrides.userId,
    sessionClaims:
      overrides.publicMetadataRole === undefined
        ? undefined
        : { publicMetadata: { role: overrides.publicMetadataRole } },
    // The Clerk SDK signature is `getToken({ template })`, but our code only
    // calls it with `{ template: "convex" }`. We mock the resolved value
    // directly so we don't have to thread the args through. `null` is the
    // sentinel for "no token" (so the fallback bails out without hitting
    // Convex).
    getToken: vi
      .fn()
      .mockResolvedValue(
        overrides.getToken === undefined ? "convex-test-token" : overrides.getToken,
      ),
  });
}

function setClerkUser(publicMetadata: Record<string, unknown>) {
  mockClerkClient.mockResolvedValue({
    users: {
      getUser: vi.fn().mockResolvedValue({
        id: "user_test",
        publicMetadata,
        emailAddresses: [],
        primaryEmailAddressId: null,
      }),
    },
  });
}

function setClerkApiThrow(err: unknown) {
  mockClerkClient.mockResolvedValue({
    users: {
      getUser: vi.fn().mockRejectedValue(err),
    },
  });
}

beforeEach(() => {
  mockAuth.mockReset();
  mockClerkClient.mockReset();
  mockFetchQuery.mockReset();
  mockReportError.mockReset();
});

describe("getConvexAuthToken", () => {
  it("returns the token when Clerk resolves one", async () => {
    setAuth({ userId: "user_a", getToken: "convex-test-token" });
    expect(await getConvexAuthToken()).toBe("convex-test-token");
  });

  it("returns null when Clerk returns no token", async () => {
    setAuth({ userId: "user_a", getToken: null });
    expect(await getConvexAuthToken()).toBeNull();
  });
});

describe("requireAuth", () => {
  it("returns userId when Clerk auth resolves a user", async () => {
    setAuth({ userId: "user_a" });
    expect(await requireAuth()).toBe("user_a");
  });

  it("throws UnauthorizedError when there is no user", async () => {
    setAuth({ userId: null });
    await expect(requireAuth()).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe("getServerUserRole", () => {
  it("returns {role, hasKey: true} when Clerk has the role key with a known value", async () => {
    setClerkUser({ role: "instructor" });
    expect(await getServerUserRole("user_a")).toEqual({
      role: "instructor",
      hasKey: true,
    });
  });

  it("returns {role: 'student', hasKey: false} when Clerk has no role key", async () => {
    setClerkUser({});
    expect(await getServerUserRole("user_a")).toEqual({
      role: "student",
      hasKey: false,
    });
  });

  it("returns {role: 'student', hasKey: false} when Clerk role key has an unknown value", async () => {
    setClerkUser({ role: "typo-from-admin" });
    expect(await getServerUserRole("user_a")).toEqual({
      role: "student",
      hasKey: false,
    });
  });

  it("returns {role: 'student', hasKey: false} and reports the error when Clerk API throws", async () => {
    setClerkApiThrow(new Error("clerk outage"));
    expect(await getServerUserRole("user_a")).toEqual({
      role: "student",
      hasKey: false,
    });
    expect(mockReportError).toHaveBeenCalledOnce();
    expect(mockReportError.mock.calls[0][0]).toMatchObject({
      source: "auth-helpers.getServerUserRole",
      level: "warn",
    });
  });
});

describe("requireRole — happy path (no Clerk API call)", () => {
  it("returns instructor when JWT already asserts instructor", async () => {
    setAuth({ userId: "user_a", publicMetadataRole: "instructor" });
    // Clerk API must NOT be called in this case.
    const result = await requireRole("instructor");
    expect(result).toEqual({ id: "user_a", role: "instructor" });
    expect(mockClerkClient).not.toHaveBeenCalled();
    expect(mockFetchQuery).not.toHaveBeenCalled();
  });

  it("returns admin when JWT already asserts admin", async () => {
    setAuth({ userId: "user_a", publicMetadataRole: "admin" });
    const result = await requireRole("admin");
    expect(result).toEqual({ id: "user_a", role: "admin" });
    expect(mockClerkClient).not.toHaveBeenCalled();
  });
});

describe("requireRole('instructor') — DB fallback (HUC-47)", () => {
  // The DB fallback runs whenever the resolved role is not 'instructor'/'admin'
  // AND the live Clerk API has no role key set. JWT-undefined (role key never
  // written) and JWT-stale-student (role key was removed but the JWT still says
  // 'student') both reach the same fallback branch — consolidate with it.each
  // so a refactor that breaks one cannot silently pass via the other
  // (Greptile round-2 P2).
  it.each([
    { name: "JWT is missing", jwtRole: undefined },
    {
      name: "stale JWT says 'student' (round-4 P1 case)",
      jwtRole: "student",
    },
  ])(
    "returns instructor when $name and Clerk has no role key and DB has an active instructor row",
    async ({ jwtRole }) => {
      setAuth({ userId: "user_a", publicMetadataRole: jwtRole });
      setClerkUser({});
      mockFetchQuery.mockResolvedValue({
        _id: "instructor_1",
        userId: "user_a",
        deletedAt: undefined,
      });
      const result = await requireRole("instructor");
      expect(result).toEqual({ id: "user_a", role: "instructor" });
      // Lock down the call shape: getCurrentInstructor is identity-scoped
      // (Convex token in the third arg, no args object). If the helper ever
      // changes to pass a `userId` arg directly, this test fails — that's
      // intentional, because the identity-scoped query is the security model.
      expect(mockFetchQuery).toHaveBeenCalledWith(
        "instructors.getCurrentInstructor",
        {},
        { token: "convex-test-token" },
      );
    },
  );

  it("throws ForbiddenError when DB row belongs to a different user (identity drift)", async () => {
    setAuth({ userId: "user_a", publicMetadataRole: undefined });
    setClerkUser({});
    mockFetchQuery.mockResolvedValue({
      _id: "instructor_1",
      userId: "user_b",
      deletedAt: undefined,
    });
    await expect(requireRole("instructor")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("throws ForbiddenError when the instructor row is soft-deleted", async () => {
    setAuth({ userId: "user_a", publicMetadataRole: undefined });
    setClerkUser({});
    mockFetchQuery.mockResolvedValue({
      _id: "instructor_1",
      userId: "user_a",
      deletedAt: 1700000000000,
    });
    await expect(requireRole("instructor")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("throws ForbiddenError when no instructor row exists", async () => {
    setAuth({ userId: "user_a", publicMetadataRole: undefined });
    setClerkUser({});
    mockFetchQuery.mockResolvedValue(null);
    await expect(requireRole("instructor")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("throws ForbiddenError when Convex DB lookup fails (catch swallows, fallback denies)", async () => {
    setAuth({ userId: "user_a", publicMetadataRole: undefined });
    setClerkUser({});
    mockFetchQuery.mockRejectedValue(new Error("convex down"));
    await expect(requireRole("instructor")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(mockReportError).toHaveBeenCalled();
  });

  it("throws ForbiddenError when there is no Convex token (mirror getCurrentInstructor pattern)", async () => {
    setAuth({ userId: "user_a", publicMetadataRole: undefined, getToken: null });
    setClerkUser({});
    await expect(requireRole("instructor")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(mockFetchQuery).not.toHaveBeenCalled();
  });
});

describe("requireRole('instructor') — explicit demotion respected", () => {
  it("throws ForbiddenError when Clerk API has role: 'student' even with active DB row", async () => {
    setAuth({ userId: "user_a", publicMetadataRole: undefined });
    setClerkUser({ role: "student" });
    mockFetchQuery.mockResolvedValue({
      _id: "instructor_1",
      userId: "user_a",
      deletedAt: undefined,
    });
    await expect(requireRole("instructor")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("throws ForbiddenError when Clerk API has role: 'support' even with active DB row", async () => {
    setAuth({ userId: "user_a", publicMetadataRole: undefined });
    setClerkUser({ role: "support" });
    mockFetchQuery.mockResolvedValue({
      _id: "instructor_1",
      userId: "user_a",
      deletedAt: undefined,
    });
    await expect(requireRole("instructor")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("throws ForbiddenError when JWT already says 'student' AND Clerk API says 'student' (no DB fallback)", async () => {
    setAuth({ userId: "user_a", publicMetadataRole: "student" });
    setClerkUser({ role: "student" });
    mockFetchQuery.mockResolvedValue({
      _id: "instructor_1",
      userId: "user_a",
      deletedAt: undefined,
    });
    await expect(requireRole("instructor")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("requireRole — admin gate", () => {
  it("throws ForbiddenError when JWT says 'instructor' but admin is required", async () => {
    setAuth({ userId: "user_a", publicMetadataRole: "instructor" });
    await expect(requireRole("admin")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ForbiddenError when JWT says 'student' AND Clerk has no role key AND no admin row (admin has no DB fallback)", async () => {
    setAuth({ userId: "user_a", publicMetadataRole: "student" });
    setClerkUser({});
    // Even if there IS an instructor row, admin gate must not upgrade.
    mockFetchQuery.mockResolvedValue({
      _id: "instructor_1",
      userId: "user_a",
      deletedAt: undefined,
    });
    await expect(requireRole("admin")).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockFetchQuery).not.toHaveBeenCalled();
  });
});

describe("requireRoleForApi('instructor')", () => {
  it("returns instructor when JWT already asserts instructor (no Clerk API call)", async () => {
    setAuth({ userId: "user_a", publicMetadataRole: "instructor" });
    const result = await requireRoleForApi("instructor");
    expect(result).toEqual({ id: "user_a", role: "instructor" });
    expect(mockClerkClient).not.toHaveBeenCalled();
  });

  it("returns instructor when stale JWT says 'student' but Clerk has no role key and DB has active instructor row", async () => {
    setAuth({ userId: "user_a", publicMetadataRole: "student" });
    setClerkUser({});
    mockFetchQuery.mockResolvedValue({
      _id: "instructor_1",
      userId: "user_a",
      deletedAt: undefined,
    });
    const result = await requireRoleForApi("instructor");
    expect(result).toEqual({ id: "user_a", role: "instructor" });
  });

  it("throws ForbiddenError when Clerk API has explicit demotion", async () => {
    setAuth({ userId: "user_a", publicMetadataRole: undefined });
    setClerkUser({ role: "student" });
    mockFetchQuery.mockResolvedValue({
      _id: "instructor_1",
      userId: "user_a",
      deletedAt: undefined,
    });
    await expect(requireRoleForApi("instructor")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("throws ForbiddenError when requireRoleForApi('admin') and JWT says 'student' with no admin signal", async () => {
    setAuth({ userId: "user_a", publicMetadataRole: "student" });
    setClerkUser({});
    await expect(requireRoleForApi("admin")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  // ---------------------------------------------------------------------
  // Convex authoritative admin gate (`requireRoleForApi('admin')`).
  //
  // The fast path is still Clerk publicMetadata.role — only when Clerk
  // says "admin" do we additionally query Convex via api.admin.getMyRole.
  // A stale Clerk claim is no longer enough; the Convex `users.role`
  // table is the source of truth (AGENTS.md).
  // ---------------------------------------------------------------------

  it("returns admin when JWT already asserts admin AND Convex getMyRole says 'admin'", async () => {
    setAuth({ userId: "user_a", publicMetadataRole: "admin" });
    mockFetchQuery.mockResolvedValue({ role: "admin" });
    const result = await requireRoleForApi("admin");
    expect(result).toEqual({ id: "user_a", role: "admin" });
    expect(mockFetchQuery).toHaveBeenCalledWith(
      "admin.getMyRole",
      {},
      expect.objectContaining({ token: "convex-test-token" }),
    );
  });

  it("throws ForbiddenError when JWT says 'admin' but Convex getMyRole says 'student' (drift)", async () => {
    // Simulates a demoted admin: Clerk metadata still says admin (JWT
    // hasn't refreshed yet) but the Convex users.role row has been
    // patched by an existing admin. Without the Convex check, this
    // would slip past the Clerk-only fast path.
    setAuth({ userId: "user_a", publicMetadataRole: "admin" });
    mockFetchQuery.mockResolvedValue({ role: "student" });
    await expect(requireRoleForApi("admin")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("throws ForbiddenError when JWT says 'admin' but Convex getMyRole returns null (no users row)", async () => {
    // First-time sign-in with no Convex users row yet. The Clerk → Convex
    // sync may still be in flight (apps/platform uses the Clerk webhook
    // → Inngest → setUserRoleTrusted chain). Deny at this layer — the
    // caller should retry after sync completes.
    setAuth({ userId: "user_a", publicMetadataRole: "admin" });
    mockFetchQuery.mockResolvedValue({ role: null });
    await expect(requireRoleForApi("admin")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("throws ForbiddenError and reports the failure when Convex getMyRole throws (fail closed)", async () => {
    setAuth({ userId: "user_a", publicMetadataRole: "admin" });
    mockFetchQuery.mockRejectedValue(new Error("convex outage"));
    await expect(requireRoleForApi("admin")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(mockReportError).toHaveBeenCalledOnce();
    expect(mockReportError.mock.calls[0][0]).toMatchObject({
      source: "auth-helpers.checkConvexAdminRole",
      level: "warn",
      message: expect.stringContaining("admin"),
    });
  });

  it("does not call Convex getMyRole when requireRoleForApi is for 'instructor' (only admin gate)", async () => {
    // The Convex roundtrip is gated to `role === "admin"` only — the
    // student/instructor paths still use the existing Clerk + Convex
    // instructor-row fallback. Verify the auth-helpers don't pay for the
    // admin roundtrip on instructor calls.
    setAuth({ userId: "user_a", publicMetadataRole: "instructor" });
    const result = await requireRoleForApi("instructor");
    expect(result).toEqual({ id: "user_a", role: "instructor" });
    const callsToAdmin = mockFetchQuery.mock.calls.filter(
      (call) => call[0] === "admin.getMyRole",
    );
    expect(callsToAdmin).toHaveLength(0);
  });

  // ---------------------------------------------------------------------
  // Bootstrap escape hatch: `skipConvexAdminCheck: true` is reserved for
  // `/api/admin/convex/seed-role`, the only legitimate path that elevates
  // a brand-new Clerk admin into the Convex `users.role` table.
  // ---------------------------------------------------------------------

  it("skips the Convex admin check when skipConvexAdminCheck: true (bootstrap path)", async () => {
    // Simulates a Clerk admin who has no Convex users.role row yet —
    // without the escape hatch, requireRoleForApi would 403 and the
    // seed-role route could never bootstrap them. The Clerk JWT claim
    // alone is trusted because Clerk publicMetadata.role is itself
    // gated by an existing admin at the Clerk dashboard level.
    setAuth({ userId: "user_bootstrap", publicMetadataRole: "admin" });
    const result = await requireRoleForApi("admin", {
      skipConvexAdminCheck: true,
    });
    expect(result).toEqual({ id: "user_bootstrap", role: "admin" });
    const callsToAdmin = mockFetchQuery.mock.calls.filter(
      (call) => call[0] === "admin.getMyRole",
    );
    expect(callsToAdmin).toHaveLength(0);
  });

  it("still rejects when JWT does not assert admin even with skipConvexAdminCheck (Clerk gate is mandatory)", async () => {
    // The escape hatch only skips the Convex check — the Clerk gate is
    // never bypassed. A caller without `publicMetadata.role === "admin"`
    // in the JWT must still 403.
    setAuth({ userId: "user_bootstrap", publicMetadataRole: "student" });
    await expect(
      requireRoleForApi("admin", { skipConvexAdminCheck: true }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockFetchQuery).not.toHaveBeenCalled();
  });
});

describe("requireAdminOrSupportForApi", () => {
  it("returns admin when JWT says 'admin'", async () => {
    setAuth({ userId: "user_a", publicMetadataRole: "admin" });
    const result = await requireAdminOrSupportForApi();
    expect(result).toEqual({ id: "user_a", role: "admin" });
  });

  it("returns support when JWT says 'support'", async () => {
    setAuth({ userId: "user_a", publicMetadataRole: "support" });
    const result = await requireAdminOrSupportForApi();
    expect(result).toEqual({ id: "user_a", role: "support" });
  });

  it("throws ForbiddenError when JWT says 'instructor' (no admin/support DB fallback)", async () => {
    setAuth({ userId: "user_a", publicMetadataRole: "instructor" });
    await expect(requireAdminOrSupportForApi()).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("throws ForbiddenError when JWT says 'student' (no admin/support DB fallback)", async () => {
    setAuth({ userId: "user_a", publicMetadataRole: "student" });
    setClerkUser({});
    await expect(requireAdminOrSupportForApi()).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
