import { clerkClient } from "@clerk/nextjs/server";

const isDev = process.env.NODE_ENV === "development";
const isPreview = process.env.VERCEL_ENV === "preview" || process.env.CF_PAGES_BRANCH;
const isCloudflare = process.env.CF_PAGES !== undefined;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || (isDev || isPreview || isCloudflare ? "https://dev.mentorships.huckleberry.art" : undefined);

if (!APP_URL) {
  throw new Error("NEXT_PUBLIC_APP_URL must be configured in production environments");
}

export interface CreateClerkInvitationOptions {
  emailAddress: string;
  instructorId?: string;
  redirectUrl?: string;
}

export interface CreateStudentClerkInvitationOptions {
  emailAddress: string;
  studentId?: string;
  redirectUrl?: string;
  /**
   * PR 12 PR 3: `onboardingId` is the `adminOnboardings` row the
   * student is being invited into. Set on Clerk's `publicMetadata`
   * so the post-signup redirect (apps/platform/app/sign-up-redirect)
   * can route the student straight to `/onboarding/[onboardingId]`
   * instead of `/dashboard`. Optional to keep the legacy
   * `/api/admin/students/invite` flow working unchanged.
   */
  onboardingId?: string;
  /**
   * PR-B (Issue 3): forward `ignoreExisting` to Clerk's
   * `invitations.createInvitation`. Required for the resend flow
   * because a fresh invitation for the same email would otherwise
   * be rejected while the prior Clerk invitation is still active.
   * Set true ONLY when the caller has already revoked or is about
   * to revoke the prior invitation. Default false preserves
   * legacy-create semantics ("don't double-invite").
   */
  ignoreExisting?: boolean;
}

export interface ClerkInvitationResult {
  success: boolean;
  invitationId?: string;
  error?: string;
}

async function getClerkApi() {
  return await clerkClient();
}

/**
 * PR 12 PR 3: Build the `publicMetadata` payload Clerk stores on the
 * invitation. We always set `isStudent: true` + `role: "student"` so
 * the post-signup routing can read it via `useUser().publicMetadata`
 * without an extra Clerk API call. `studentId` (legacy) and
 * `onboardingId` (new) are included when present; Clerk treats
 * undefined as "not set", which is what we want.
 */
function buildStudentPublicMetadata(args: {
  studentId: string | undefined;
  onboardingId: string | undefined;
}): Record<string, string | boolean> {
  const metadata: Record<string, string | boolean> = {
    isStudent: true,
    role: "student",
  };
  if (args.studentId) metadata.studentId = args.studentId;
  if (args.onboardingId) metadata.onboardingId = args.onboardingId;
  return metadata;
}

export async function createClerkInvitation(
  options: CreateClerkInvitationOptions
): Promise<ClerkInvitationResult> {
  // Route invites to the in-app SignUp page so Clerk processes the invitation ticket
  const { emailAddress, instructorId, redirectUrl = `${APP_URL}/sign-up` } = options;

  try {
    const client = await getClerkApi();

    const invitation = await client.invitations.createInvitation({
      emailAddress,
      redirectUrl,
      publicMetadata: instructorId
        ? { instructorId, isInstructor: true, role: "instructor" }
        : { isInstructor: true, role: "instructor" },
    });

    return {
      success: true,
      invitationId: invitation.id,
    };
  } catch (error) {
    console.error("Failed to create Clerk invitation:", error);

    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    if (errorMessage.includes("already exists") || errorMessage.includes("already been invited")) {
      return {
        success: false,
        error: "User with this email already exists or has been invited",
      };
    }

    return {
      success: false,
      error: errorMessage,
    };
  }
}

export async function createStudentClerkInvitation(
  options: CreateStudentClerkInvitationOptions
): Promise<ClerkInvitationResult> {
  const {
    emailAddress,
    studentId,
    redirectUrl = `${APP_URL}/sign-up`,
    onboardingId,
    ignoreExisting,
  } = options;

  try {
    const client = await getClerkApi();

    const invitation = await client.invitations.createInvitation({
      emailAddress,
      redirectUrl,
      publicMetadata: buildStudentPublicMetadata({ studentId, onboardingId }),
      // PR-B (Issue 3): the resend flow uses this — by the time we
      // call it, the prior Clerk invitation has just been revoked
      // (or is in the process of being revoked by best-effort catch
      // around the Convex write). Without this flag Clerk returns
      // "already invited" and the route 502s.
      ignoreExisting: !!ignoreExisting,
    });

    return {
      success: true,
      invitationId: invitation.id,
    };
  } catch (error) {
    console.error("Failed to create student Clerk invitation:", error);

    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    if (errorMessage.includes("already exists") || errorMessage.includes("already been invited")) {
      return {
        success: false,
        error: "User with this email already exists or has been invited",
      };
    }

    return {
      success: false,
      error: errorMessage,
    };
  }
}

export async function getClerkUserByEmail(email: string): Promise<string | null> {
  try {
    const client = await getClerkApi();
    const response = await client.users.getUserList({
      emailAddress: [email],
      limit: 1,
    });

    const users = response.data;
    if (users.length > 0) {
      return users[0].id;
    }
    return null;
  } catch (error) {
    console.error("Failed to get Clerk user by email:", error);
    return null;
  }
}

export async function searchClerkUsers(query: string): Promise<
  Array<{
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
  }>
> {
  try {
    const client = await getClerkApi();
    const response = await client.users.getUserList({
      query,
      limit: 10,
    });

    return response.data.map((user) => ({
      id: user.id,
      email: user.emailAddresses[0]?.emailAddress || "",
      firstName: user.firstName || undefined,
      lastName: user.lastName || undefined,
    }));
  } catch (error) {
    console.error("Failed to search Clerk users:", error);
    return [];
  }
}

export interface SetInstructorMetadataOptions {
  /**
   * The Clerk user ID to update. MUST start with `user_` — the helper
   * refuses non-Clerk-shaped ids so we never silently write to a
   * placeholder (`admin-${slug}`, `seed-${slug}`) row that could later
   * be claimed by the linking flow.
   */
  userId: string;
  /**
   * Optional Convex instructor row id to stamp on `publicMetadata.instructorId`.
   * Lets the post-signin redirect read the linked-instructor id from JWT
   * claims without a follow-up Convex lookup.
   */
  instructorId?: string | null;
  /**
   * Caller's intent. Defaults to `"preserve"`.
   *
   * `"preserve"`  — routine path. Respects `isInstructor: true` (no-op)
   *                 and explicit demotions (`role: "student"` left
   *                 alone). The safe default for any call that fires on
   *                 something other than an explicit admin-initiated
   *                 promotion (bio edits, deactivate toggles, sync-role
   *                 self-heal where the demotion gate already passed).
   *
   * `"promote"`   — admin-initiated promotion path. Bypasses the
   *                 demotion short-circuit so an admin creating a new
   *                 instructor by adopting an existing Clerk user (or
   *                 re-activating a previously inactive record) can
   *                 stamp the role flag even when the underlying Clerk
   *                 metadata currently reads `role: "student"`. Use
   *                 ONLY when the caller has confirmed the user is
   *                 meant to be (re-)elevated to instructor.
   *
   * Greptile P1 (third pass, fix/instructor-role-claim-in-clerk):
   * the original implementation overrode any `role: "student"` claim.
   * Defaulting to `"preserve"` closes that loophole without changing
   * the explicit creation/re-activation flows (those now opt in to
   * `"promote"` at the call site).
   */
  intent?: "promote" | "preserve";
}

export interface SetInstructorMetadataResult {
  /** True when the helper wrote the metadata. */
  updated: boolean;
  /** When `updated === false`, the reason we skipped. */
  reason?:
    | "already-set"
    | "user-not-found"
    | "non-clerk-user-id"
    | "would-clobber-demotion";
}

/**
 * Roles whose authority is greater than "instructor". Stamp
 * `publicMetadata.role = "instructor"` on existing-but-not-elevated
 * users, but NEVER overwrite an admin / video_editor / support claim —
 * the admin who creates the instructor record is the most likely
 * accidentally-adopted user (someone entering their own email in the
 * create form), and downgrading them would lock them out of /admin.
 *
 * See Greptile P1 (PR fix/instructor-role-claim-in-clerk): the original
 * implementation overwrote `role` unconditionally.
 */
const ELEVATED_ROLES = new Set(["admin", "video_editor", "support"]);

/** Map Clerk API errors to a stable shape. The Backend SDK surfaces
 *  status on the thrown error directly, plus an `errors[]` array on
 *  rate-limited responses. */
function clerkErrorStatus(e: unknown): number | undefined {
  if (!e || typeof e !== "object") return undefined;
  const direct = (e as { status?: unknown }).status;
  if (typeof direct === "number") return direct;
  const errors = (e as { errors?: unknown }).errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const s = (errors[0] as { status?: unknown }).status;
    if (typeof s === "number") return s;
  }
  return undefined;
}

/**
 * Stamp `publicMetadata.role = "instructor"` and `isInstructor = true` on an
 * EXISTING Clerk user. Used by the admin create/edit instructor flow when
 * an instructor row is bound to a Clerk user that already exists in the
 * instance (e.g. adopted-by-email). Without this write, the post-signin
 * routing in `app/auth-redirect/page.tsx` reads the missing role claim and
 * falls through to the student dashboard.
 *
 * Behavior:
 *   - Reads current `publicMetadata` first; deep-merges into it so any
 *     existing keys (admin-set flags, instructor-specific scalar fields,
 *     unrelated metadata) are preserved.
 *   - In `"preserve"` intent (default), short-circuits on:
 *       (a) `isInstructor: true` — already-set, idempotent.
 *       (b) `role: "student"` — explicit demotion by an admin. A
 *           demotion is intentional and not undone by a routine bio
 *           edit or sync-role self-heal. Returns
 *           `{ updated: false, reason: "would-clobber-demotion" }`.
 *   - In `"promote"` intent, skips the demotion short-circuit. The
 *     already-set short-circuit still applies (no point rewriting the
 *     same keys). Use `"promote"` ONLY at explicit promotion sites
 *     (POST, PATCH rebind, PUT isActive false→true transition).
 *   - Never overwrites an elevated role (admin / video_editor / support)
 *     with "instructor" — see ELEVATED_ROLES. This protects admins who
 *     accidentally enter their own email into the create form.
 *   - Refuses non-Clerk-shaped ids with a thrown error (caller bug).
 *   - Returns `{ updated: false, reason: "user-not-found" }` ONLY for a
 *     Clerk 404 on `getUser`. Rethrows for any other error (5xx,
 *     network, rate-limit) so the caller can decide to retry instead
 *     of treating a transient blip as "user gone".
 *
 * Greptile P1 (third pass): a bio-only PUT was silently re-promoting
 * a previously-demoted user because the helper only short-circuited
 * on `isInstructor: true`. The demotion short-circuit + the default-
 * preserve intent close that loophole at the helper boundary; PUT
 * additionally avoids calling the helper at all for non-promotion
 * edits ("separate account promotion from routine profile edits").
 */
export async function setInstructorPublicMetadataOnUser(
  opts: SetInstructorMetadataOptions
): Promise<SetInstructorMetadataResult> {
  if (!opts.userId || !opts.userId.startsWith("user_")) {
    throw new Error(
      `setInstructorPublicMetadataOnUser: refusing to write Clerk publicMetadata to non-Clerk-shaped id "${opts.userId}". Use createClerkInvitation for new-user signup, or pass a real Clerk user id (user_*).`
    );
  }

  const intent = opts.intent ?? "preserve";

  const client = await getClerkApi();

  let user;
  try {
    user = await client.users.getUser(opts.userId);
  } catch (e) {
    // Greptile P2 (PR fix/instructor-role-claim-in-clerk): collapse
    // every read error into "user-not-found" and the caller cannot
    // distinguish a real deletion from a transient outage. Only a
    // 404 means the user is gone; everything else rethrows.
    if (clerkErrorStatus(e) === 404) {
      console.warn(
        "[platform:setInstructorPublicMetadataOnUser] Clerk 404 for",
        opts.userId,
      );
      return { updated: false, reason: "user-not-found" };
    }
    throw e;
  }

  const current = (user.publicMetadata ?? {}) as Record<string, unknown>;
  // Greptile P1 (fourth pass): the "already-set" short-circuit used
  // to fire whenever `isInstructor === true` regardless of `role`.
  // That meant a desynced state where an admin had manually changed
  // `role` via the Clerk dashboard (e.g. demoted to "student" without
  // clearing `isInstructor`) was unrepairable from promote sites.
  // Short-circuit only on the fully-stamped shape: `isInstructor`
  // AND `role === "instructor"`. Promote sites additionally
  // self-heal the desynced shape by writing the merged metadata.
  if (current.isInstructor === true && current.role === "instructor") {
    return { updated: false, reason: "already-set" };
  }

  // Greptile P1 (third pass): preserve an explicit demotion. An admin
  // demoting a user back to student (sets role: "student", isInstructor:
  // false) must not be undone by a routine bio edit or sync-role
  // self-heal. Promote-intent callers (admin-initiated promotions)
  // intentionally bypass this.
  if (intent === "preserve" && current.role === "student") {
    return { updated: false, reason: "would-clobber-demotion" };
  }

  const currentRole = typeof current.role === "string" ? current.role : undefined;
  const merged: Record<string, unknown> = {
    ...current,
    isInstructor: true,
    // Preserve an elevated role (the admin who accidentally entered
    // their own email is the canonical scenario). The auth-redirect
    // router will still route them to /admin first; instructor-view
    // access is granted by the `isInstructor: true` flag plus the
    // DB fallback in `lib/auth-helpers.ts`.
    role: currentRole && ELEVATED_ROLES.has(currentRole) ? currentRole : "instructor",
  };
  if (opts.instructorId) {
    merged.instructorId = String(opts.instructorId);
  }

  await client.users.updateUserMetadata(opts.userId, {
    publicMetadata: merged,
  });
  return { updated: true };
}
