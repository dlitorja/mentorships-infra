import { auth, clerkClient } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { reportError } from "@/lib/observability";
import { UnauthorizedError, ForbiddenError } from "@/lib/errors";

export type UserRole = "admin" | "instructor" | "student" | "support";

const KNOWN_ROLES: readonly UserRole[] = ["admin", "instructor", "student", "support"];

function isKnownRole(value: unknown): value is UserRole {
  return typeof value === "string" && (KNOWN_ROLES as readonly string[]).includes(value);
}

/**
 * True when the signed-in user has an active (non-soft-deleted) `instructors`
 * row in Convex matching their Clerk `userId`. Used as the DB fallback in
 * `requireRole("instructor")` when Clerk's `publicMetadata.role` is missing
 * or non-`instructor`.
 *
 * HUC-47: dual-source-of-truth fix. Without this, an instructor whose Clerk
 * metadata is missing (common for legacy / admin-created accounts) hits
 * `requireRole("instructor")` → `ForbiddenError` → 500 on the dashboard,
 * even though they are a real instructor in the `instructors` table. The
 * DB fallback closes the hole without widening access: only users with a
 * real, active `instructors` row get the upgrade.
 *
 * Why this fallback is safe despite Convex being authoritative on instructor
 * membership (per AGENTS.md / `instructor` policy): a user reaching this
 * path has Clerk role != `instructor` && != `admin`, so the admin has
 * either (a) never written a role, (b) explicitly cleared it, or (c) the
 * Clerk → Convex sync is lagging. In all three cases the live truth is
 * the `instructors` row. A soft-deleted instructor row (set by
 * `convex/instructors.ts:1714`'s `softDeleteInstructor`) is filtered out
 * so demotion via soft-delete still revokes access even when Clerk
 * metadata was never updated.
 *
 * The call site (`requireRole`) only invokes this when Clerk role is NOT
 * `instructor`/`admin`, so well-configured instructors (Clerk
 * `publicMetadata.role === "instructor"`) don't pay the extra `fetchQuery`
 * on every page load — the DB read is on the unhappy path only.
 */
async function hasInstructorRecord(userId: string): Promise<boolean> {
  try {
    // `convex/nextjs` requires a token to authenticate; without one, the
    // `getCurrentInstructor` query (which reads `ctx.auth.getUserIdentity()`)
    // would return null. Mirror the pattern in
    // `components/navigation/protected-layout.tsx` and bail to `false` when
    // we have no token — there's nothing for the fallback to upgrade.
    const token = await getConvexAuthToken();
    if (!token) return false;
    const row = await fetchQuery(
      api.instructors.getCurrentInstructor,
      {},
      { token }
    );
    // `getCurrentInstructor` is identity-scoped via the Convex token, so a
    // row here means the signed-in user IS the instructor. Defense-in-depth:
    // also require `userId` to match the row's `userId`, in case the
    // identity binding ever drifts. Soft-deletion must deny the fallback:
    // `getCurrentInstructor` does not filter on `deletedAt`, so without
    // this check an admin soft-deleting an instructor (via
    // `convex/instructors.ts:1714`'s `softDeleteInstructor`) would still
    // leave the user able to hit `/instructor/*` through the DB fallback.
    return (
      !!row &&
      (row.userId === undefined || row.userId === userId) &&
      row.deletedAt === undefined
    );
  } catch (err) {
    // Swallow: a Convex outage shouldn't escalate to a 500 just because the
    // fallback couldn't run. Surface to observability so the operator sees
    // the DB-fallback failure mode separately from the legitimate 403.
    await reportError({
      source: "auth-helpers.hasInstructorRecord",
      error: err instanceof Error ? err : new Error(String(err)),
      level: "warn",
      message: "Instructor DB lookup failed during requireRole fallback",
      context: { userId },
    });
    return false;
  }
}

export async function getConvexAuthToken(): Promise<string | null> {
  const clerkAuth = await auth();
  return clerkAuth.getToken({ template: "convex" });
}

export async function getClerkUserEmail(userId: string): Promise<string | null> {
  try {
    const { sessionClaims } = await auth();
    const email = sessionClaims?.email;
    if (typeof email === "string" && email) {
      return email.toLowerCase();
    }
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const primaryEmail = user.emailAddresses.find(
      (e) => e.id === user.primaryEmailAddressId
    );
    return primaryEmail?.emailAddress.toLowerCase() ?? null;
  } catch (err) {
    console.error("[auth-helpers] Failed to get user email:", err);
    return null;
  }
}

/**
 * Live Clerk role lookup. Returns both the resolved role and whether the
 * role key was explicitly set in `publicMetadata` — the latter is what
 * callers need to distinguish a deliberate demotion (`role: "student"`
 * set by an admin) from a stale JWT (no role key in claims, but Clerk
 * has one). The default-`"student"` return applies only when (a) the
 * API succeeded but the role key is absent, or (b) the API failed
 * (with a `reportError` warning). Both produce `hasKey: false`.
 */
export async function getServerUserRole(
  userId: string
): Promise<{ role: UserRole; hasKey: boolean }> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const role = user.publicMetadata?.role;
    if (isKnownRole(role)) {
      return { role, hasKey: true };
    }
    // Clerk succeeded but the role key is missing — default to "student"
    // for backward compatibility, but signal `hasKey: false` so the
    // instructor fallback can still widen access (HUC-47).
    return { role: "student", hasKey: false };
  } catch (err) {
    // Emit a warning so outages are observable; fall through to default.
    await reportError({
      source: "auth-helpers.getServerUserRole",
      error: err instanceof Error ? err : new Error(String(err)),
      level: "warn",
      message: "Failed to fetch user role from Clerk API, defaulting to 'student'",
      context: { userId },
    });
    return { role: "student", hasKey: false };
  }
}

export async function requireAuth() {
  const { userId } = await auth();
  if (!userId) {
    // Throw typed error so API routes can classify to 401
    throw new UnauthorizedError("Unauthorized");
  }
  return userId;
}

export async function requireRole(requiredRole: "admin" | "instructor" | "student" | "support") {
  const { userId, sessionClaims } = await auth();
  if (!userId) {
    // Throw typed error for consistent handling
    throw new UnauthorizedError("Unauthorized");
  }

  // Resolve the user's role. Trust the session claim when it asserts a
  // *positive* role (`instructor` / `admin`) — those are the values we
  // gate against, and a stale claim here just means the user keeps
  // access for the JWT lifetime after a fresh demotion, which is the
  // pre-existing trade-off. For `student` / `support` / undefined claims
  // we go to the live Clerk API so the explicit-demotion signal reflects
  // the current server state, not a stale JWT.
  const claimsRole = (sessionClaims?.publicMetadata as Record<string, unknown> | undefined)?.role;
  let server: { role: UserRole; hasKey: boolean } | null = null;
  if (!isKnownRole(claimsRole) || claimsRole === "student" || claimsRole === "support") {
    server = await getServerUserRole(userId);
  }
  const role: UserRole =
    claimsRole === "instructor" || claimsRole === "admin"
      ? claimsRole
      : server!.role;
  const clerkApiHasKey = server?.hasKey ?? false;

  if (requiredRole === "admin" && role !== "admin") {
    throw new ForbiddenError("Admin role required");
  }

  if (requiredRole === "instructor" && role !== "instructor" && role !== "admin") {
    // HUC-47: Clerk doesn't know this user is an instructor (e.g. legacy
    // or admin-created account without a Clerk publicMetadata.role).
    // Before 403'ing, ask Convex — `getCurrentInstructor` is identity-
    // scoped and only returns the row when the user has an ACTIVE (non-
    // soft-deleted) `instructors` record.
    //
    // We gate the fallback on `clerkApiHasKey` ONLY (not on the JWT
    // claim) so a stale `student`/`support` claim cannot block an
    // active instructor whose Clerk role key was simply removed.
    // If the live Clerk API still has the role key set to anything
    // other than `instructor`/`admin`, that is an explicit demotion and
    // the fallback is skipped — handles the fresh-demotion JWT-lag case
    // without the round-3 P1 stale-claim bypass. See
    // `docs/post-merge/instructor-dashboard-and-one-way-audio.md` for
    // the dual-source-of-truth analysis.
    if (!clerkApiHasKey && (await hasInstructorRecord(userId))) {
      return { id: userId, role: "instructor" };
    }
    throw new ForbiddenError("Instructor role required");
  }

  return { id: userId, role };
}

export async function requireRoleForApi(requiredRole: "admin" | "instructor") {
  const { userId, sessionClaims } = await auth();
  if (!userId) {
    // Typed error so API handlers return 401
    throw new UnauthorizedError("Unauthorized");
  }

  // Resolve the user's role. Trust positive session claims (`instructor`
  // / `admin`) and otherwise call the live Clerk API — see `requireRole`
  // above for the JWT-lag trade-off rationale.
  const claimsRole = (sessionClaims?.publicMetadata as Record<string, unknown> | undefined)?.role;
  let server: { role: UserRole; hasKey: boolean } | null = null;
  if (!isKnownRole(claimsRole) || claimsRole === "student" || claimsRole === "support") {
    server = await getServerUserRole(userId);
  }
  const role: UserRole =
    claimsRole === "instructor" || claimsRole === "admin"
      ? claimsRole
      : server!.role;
  const clerkApiHasKey = server?.hasKey ?? false;

  if (requiredRole === "admin" && role !== "admin") {
    // Typed error so API handlers return 403
    throw new ForbiddenError("Admin role required");
  }

  if (requiredRole === "instructor" && role !== "instructor" && role !== "admin") {
    // HUC-47: see `requireRole` above. Same DB fallback applies to API
    // routes so they don't 403 a legitimate instructor whose Clerk
    // metadata is missing. Gated on the live Clerk API state only (not
    // the JWT claim) to avoid a stale `student`/`support` claim blocking
    // an active instructor whose Clerk role key was removed.
    if (!clerkApiHasKey && (await hasInstructorRecord(userId))) {
      return { id: userId, role: "instructor" };
    }
    throw new ForbiddenError("Instructor role required");
  }

  return { id: userId, role };
}

/**
 * PR admin-onboarding #1: admin or support role gate for the new onboarding
 * endpoints. Admin remains a superset; support is the new role. Both can
 * preview, commit, retry, and cancel onboarding submissions. Wider
 * instructor/student actions remain gated by `requireRoleForApi("admin")`.
 */
export async function requireAdminOrSupportForApi(): Promise<{ id: string; role: UserRole }> {
  const { userId, sessionClaims } = await auth();
  if (!userId) {
    throw new UnauthorizedError("Unauthorized");
  }
  const claimsRole = (sessionClaims?.publicMetadata as Record<string, unknown> | undefined)?.role;
  const role: UserRole = isKnownRole(claimsRole)
    ? claimsRole
    : (await getServerUserRole(userId)).role;
  if (role !== "admin" && role !== "support") {
    throw new ForbiddenError("Admin or support role required");
  }
  return { id: userId, role };
}
