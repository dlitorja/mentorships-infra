import { query, mutation, internalMutation, internalQuery, action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { MutationCtx, QueryCtx, ActionCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * State machine: which `(from, to)` transitions are allowed for the
 * onboarding record. Mirrored in `apps/platform/lib/admin-onboarding.ts`
 * for the client. Implemented as a const-map so codegen/tests can read
 * transitions statically.
 */
const ALLOWED_TRANSITIONS: Record<string, ReadonlyArray<string>> = {
  queued: ["processing", "cancelled"],
  processing: ["completed", "failed", "cancelled"],
  failed: ["processing", "cancelled"],
  cancelled: [],
  completed: [],
};

/**
 * Pure helper: returns whether the given state transition is permitted by
 * the onboarding state machine. Mirrors `ALLOWED_TRANSITIONS` in
 * `apps/platform/lib/admin-onboarding.ts`.
 */
function isAllowedTransition(from: string, to: string): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Generate a `users.onboardingAlias` value when a Convex-only split is
 * requested. Format `alias_<base36-time>_<hex-rand>` — short enough for the
 * `by_onboardingAlias` index, unique enough for in-process use.
 */
function generateAlias(): string {
  const rand = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
  const time = Date.now().toString(36);
  return `alias_${time}_${rand}`;
}

/**
 * Canonicalize an email: trim whitespace and lowercase. Mirrors the helper
 * in `apps/platform/lib/admin-onboarding.ts` so server and client agree.
 */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Lightweight RFC-shaped email regex; API routes do a stricter zod check.
 */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Treat an instructor as eligible when present, not soft-deleted, and
 * either missing an `isActive` flag (default true) or explicitly true.
 */
function isInstructorActive(instructor: Doc<"instructors"> | null): boolean {
  if (!instructor) return false;
  if (instructor.deletedAt) return false;
  if (instructor.isActive === false) return false;
  return true;
}

/**
 * Detect an existing renewal pair for `(email, instructorId)`. Looks up under
 * both the placeholder identity (`email:<email>`) used before the student
 * signs up, AND the student's Clerk userId if they have already signed up —
 * without the second lookup, a follow-up admin onboarding for a signed-up
 * student would miss the existing seat and create a duplicate enrollment
 * artifact (Greptile finding).
 */
/**
 * Detect an existing renewal pair for `(email, instructorId)`. Looks up under
 * both the placeholder identity (`email:<email>`) used before the student
 * signs up, AND the student's Clerk userId if they have already signed up —
 * without the second lookup, a follow-up admin onboarding for a signed-up
 * student would miss the existing seat and create a duplicate enrollment
 * artifact (Greptile finding).
 */
async function detectRenewal(
  ctx: QueryCtx,
  email: string,
  instructorId: Id<"instructors">
): Promise<{
  isRenewal: boolean;
  existingSeatId?: Id<"seatReservations">;
  existingWorkspaceId?: Id<"workspaces">;
}> {
  const candidates: Array<string | null | undefined> = [`email:${email}`];

  const userRow = await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", email))
    .first();
  if (userRow?.userId) {
    candidates.push(userRow.userId);
  }

  for (const userId of candidates) {
    if (!userId) continue;
    const seat = await ctx.db
      .query("seatReservations")
      .withIndex("by_userId_instructorId", (q) =>
        q.eq("userId", userId).eq("instructorId", instructorId)
      )
      .first();
    if (!seat || seat.status === "released") continue;
    const workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_seatReservationId", (q) => q.eq("seatReservationId", seat._id))
      .first();
    return {
      isRenewal: true,
      existingSeatId: seat._id,
      existingWorkspaceId: workspace?._id,
    };
  }

  return { isRenewal: false };
}

/**
 * Count of currently active `seatReservations` for the given instructor —
 * used both to compute `atCapacity` and to surface the
 * `activeStudentCount` field on the preview/row.
 */
async function getActiveStudentCount(
  ctx: QueryCtx,
  instructorId: Id<"instructors">
): Promise<number> {
  const seats = await ctx.db
    .query("seatReservations")
    .withIndex("by_instructorId_status", (q) =>
      q.eq("instructorId", instructorId).eq("status", "active")
    )
    .collect();
  return seats.length;
}

/**
 * Gate all onboarding functions to admin or support roles. Returns
 * `{ ok: true, role }` so the caller can record the role in audit logs if
 * needed. Returns `{ ok: false }` for any other identity.
 */
async function isAdminOrSupport(
  ctx: QueryCtx | MutationCtx,
  userId: string
): Promise<{ ok: true; role: "admin" | "support" } | { ok: false }> {
  const user = await ctx.db
    .query("users")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
  if (user?.role === "admin") return { ok: true, role: "admin" };
  if (user?.role === "support") return { ok: true, role: "support" };
  return { ok: false };
}

function newTimelineEntry(
  event: Doc<"adminOnboardings">["timeline"][number]["event"],
  actorUserId: string | undefined,
  details?: string
): Doc<"adminOnboardings">["timeline"][number] {
  return { at: Date.now(), event, actorUserId, details };
}

type PerInstructorInput = {
  instructorId: Id<"instructors">;
  sessionsPerInstructor: number;
  expiresAt?: number;
};

type PerInstructorPreview = {
  instructorId: Id<"instructors">;
  instructorName: string | undefined;
  isRenewal: boolean;
  existingWorkspaceId: Id<"workspaces"> | undefined;
  action: "new_workspace" | "renewal";
  sessionsPerInstructor: number;
  expiresAt: number | undefined;
  atCapacity: boolean;
  activeStudentCount: number;
  maxActiveStudents: number | undefined;
  capacityOverrideRequired: boolean;
};

/**
 * Preview-only path: validates the requested `(email, instructors[])` set
 * and returns a per-instructor view that the form can render BEFORE the
 * user clicks "Commit". Detects renewals, capacity, and existing-student
 * state without writing any rows. Mirror of `dryRun` from
 * `convex/instructors.ts:137`.
 */
export const previewAdminOnboarding = query({
  args: {
    email: v.string(),
    instructors: v.array(
      v.object({
        instructorId: v.id("instructors"),
        sessionsPerInstructor: v.number(),
        expiresAt: v.optional(v.number()),
      })
    ),
    isSeparateStudentRecord: v.optional(v.boolean()),
    notes: v.optional(v.string()),
    capacityOverrideReason: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    email: string;
    perInstructor: PerInstructorPreview[];
    existingStudent: { userId: string; firstName: string | undefined; lastName: string | undefined; existingInstructors: string[] } | null;
    capacityOverrideRequired: boolean;
    capacityOverrideReasonMissing: boolean;
    notesRequired: boolean;
    notesMissing: boolean;
    warnings: string[];
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const gate = await isAdminOrSupport(ctx, identity.subject);
    if (!gate.ok) throw new Error("Forbidden: admin or support role required");

    const email = normalizeEmail(args.email);
    if (!isValidEmail(email)) throw new Error("Invalid email");

    if (args.instructors.length === 0) {
      throw new Error("At least one instructor is required");
    }

    const perInstructor: PerInstructorPreview[] = [];
    const warnings: string[] = [];
    let anyAtCapacity = false;
    let anyCapacityRequired = false;

    for (const input of args.instructors) {
      const instructor = await ctx.db.get(input.instructorId);
      if (!isInstructorActive(instructor)) {
        throw new Error(`Instructor ${input.instructorId} not found or inactive`);
      }
      const renewal = await detectRenewal(ctx, email, input.instructorId);
      const activeCount = await getActiveStudentCount(ctx, input.instructorId);
      const max = instructor?.maxActiveStudents;
      const atCapacity = typeof max === "number" && activeCount >= max;
      if (atCapacity) anyAtCapacity = true;

      const capacityOverrideRequired = atCapacity;
      if (capacityOverrideRequired) anyCapacityRequired = true;

      perInstructor.push({
        instructorId: input.instructorId,
        instructorName: instructor?.name ?? instructor?.slug ?? undefined,
        isRenewal: renewal.isRenewal,
        existingWorkspaceId: renewal.existingWorkspaceId,
        action: renewal.isRenewal ? "renewal" : "new_workspace",
        sessionsPerInstructor: input.sessionsPerInstructor,
        expiresAt: input.expiresAt,
        atCapacity,
        activeStudentCount: activeCount,
        maxActiveStudents: max,
        capacityOverrideRequired,
      });
      if (atCapacity) {
        warnings.push(
          `Instructor ${instructor?.name ?? input.instructorId} is at capacity (${activeCount}/${max}); a reason is required to override.`
        );
      }
    }

    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();

    let existingStudent: {
      userId: string;
      firstName: string | undefined;
      lastName: string | undefined;
      existingInstructors: string[];
    } | null = null;
    if (existingUser) {
      const seats = await ctx.db
        .query("seatReservations")
        .withIndex("by_userId", (q) => q.eq("userId", existingUser.userId))
        .collect();
      const instructorNames: string[] = [];
      for (const seat of seats) {
        const ins = await ctx.db.get(seat.instructorId);
        if (ins?.name) instructorNames.push(ins.name);
      }
      existingStudent = {
        userId: existingUser.userId,
        firstName: existingUser.firstName ?? undefined,
        lastName: existingUser.lastName ?? undefined,
        existingInstructors: instructorNames,
      };
      if (!args.isSeparateStudentRecord) {
        warnings.push(
          `An account already exists for ${email} — using the existing student by default. Toggle "Create a separate student record" to split.`
        );
      }
    }

    const notesMissing = !!args.isSeparateStudentRecord && !args.notes;
    const capacityOverrideReasonMissing = anyCapacityRequired && !args.capacityOverrideReason;
    if (notesMissing) warnings.push("Notes are required when creating a separate student record.");
    if (capacityOverrideReasonMissing) {
      warnings.push("Capacity override reason is required for at-capacity instructors.");
    }

    return {
      email,
      perInstructor,
      existingStudent,
      capacityOverrideRequired: anyCapacityRequired,
      capacityOverrideReasonMissing,
      notesRequired: !!args.isSeparateStudentRecord,
      notesMissing,
      warnings,
    };
  },
});

async function performCommit(
  ctx: MutationCtx,
  args: {
    email: string;
    instructors: Array<{
      instructorId: Id<"instructors">;
      sessionsPerInstructor: number;
      expiresAt?: number;
    }>;
    isSeparateStudentRecord: boolean;
    notes: string | undefined;
    capacityOverrideReason: string | undefined;
    submittedByUserId: string;
    source: Doc<"adminOnboardings">["source"];
    /**
     * Per-instructor Clerk invitation IDs created in the API route BEFORE
     * this mutation runs. Keyed by `instructorId` so the route doesn't need
     * to align array positions with the preview response (which may have
     * flagged some pairs as renewals and skipped the Clerk call). Only
     * non-renewal pairs are written to `perInstructor[i].clerkInvitationId`;
     * renewal pairs reuse the existing seat and don't need a new invite.
     */
    clerkInvitationIds: Record<Id<"instructors">, string> | undefined;
  }
): Promise<{
  onboardingId: Id<"adminOnboardings">;
  perInstructor: Array<{
    instructorId: Id<"instructors">;
    workspaceId: Id<"workspaces"> | undefined;
    seatReservationId: Id<"seatReservations"> | undefined;
    sessionPackId: Id<"sessionPacks"> | undefined;
    isRenewal: boolean;
    sessionsPerInstructor: number;
    expiresAt: number | undefined;
    capacityOverride: boolean;
    clerkInvitationId: string | undefined;
  }>;
  existingWorkspaceIds: Id<"workspaces">[];
}> {
  const email = normalizeEmail(args.email);
  if (!isValidEmail(email)) throw new Error("Invalid email");
  if (args.instructors.length === 0) {
    throw new Error("At least one instructor is required");
  }
  if (args.isSeparateStudentRecord && !args.notes) {
    throw new Error("Notes are required when creating a separate student record");
  }

  const placeholder = `email:${email}`;
  const now = Date.now();

  let anyAtCapacity = false;
  for (const input of args.instructors) {
    if (input.sessionsPerInstructor < 1) {
      throw new Error("sessionsPerInstructor must be >= 1");
    }
    if (input.expiresAt !== undefined && input.expiresAt <= now) {
      throw new Error("expiresAt must be in the future");
    }
    const instructor = await ctx.db.get(input.instructorId);
    if (!isInstructorActive(instructor)) {
      throw new Error(`Instructor ${input.instructorId} not found or inactive`);
    }
    const activeCount = await getActiveStudentCount(ctx, input.instructorId);
    const max = instructor?.maxActiveStudents;
    if (typeof max === "number" && activeCount >= max) {
      anyAtCapacity = true;
    }
  }
  if (anyAtCapacity && !args.capacityOverrideReason) {
    throw new Error("Capacity override reason is required when any selected instructor is at capacity");
  }

  const onboardingId = await ctx.db.insert("adminOnboardings", {
    email,
    flowVersion: 1,
    source: args.source,
    submittedByUserId: args.submittedByUserId,
    status: "queued",
    attemptCount: 1,
    lastAttemptAt: now,
    perInstructor: [],
    isSeparateStudentRecord: args.isSeparateStudentRecord,
    notes: args.notes,
    capacityOverrideReason: args.capacityOverrideReason,
    existingWorkspaceIds: [],
    timeline: [newTimelineEntry("queued", args.submittedByUserId)],
    createdAt: now,
  });

  let onboardingAlias: string | undefined;
  if (args.isSeparateStudentRecord) {
    onboardingAlias = generateAlias();
    await ctx.db.insert("users", {
      userId: placeholder,
      email,
      clerkId: "",
      role: "student",
      onboardingAlias,
    });
    await ctx.db.patch(onboardingId, {
      onboardingAlias,
      timeline: [
        newTimelineEntry("queued", args.submittedByUserId),
        newTimelineEntry("alias_set", args.submittedByUserId, onboardingAlias),
      ],
    });
  }

  const perInstructorResults: Array<{
    instructorId: Id<"instructors">;
    workspaceId: Id<"workspaces"> | undefined;
    seatReservationId: Id<"seatReservations"> | undefined;
    sessionPackId: Id<"sessionPacks"> | undefined;
    isRenewal: boolean;
    sessionsPerInstructor: number;
    expiresAt: number | undefined;
    capacityOverride: boolean;
    clerkInvitationId: string | undefined;
  }> = [];
  const existingWorkspaceIds: Id<"workspaces">[] = [];

  for (const input of args.instructors) {
    const renewal = await detectRenewal(ctx, email, input.instructorId);
    const instructor = await ctx.db.get(input.instructorId);
    const activeCount = await getActiveStudentCount(ctx, input.instructorId);
    const max = instructor?.maxActiveStudents;
    const atCapacity = typeof max === "number" && activeCount >= max;

    if (renewal.isRenewal) {
      perInstructorResults.push({
        instructorId: input.instructorId,
        workspaceId: renewal.existingWorkspaceId,
        seatReservationId: renewal.existingSeatId,
        sessionPackId: undefined,
        isRenewal: true,
        sessionsPerInstructor: input.sessionsPerInstructor,
        expiresAt: input.expiresAt,
        capacityOverride: atCapacity,
        clerkInvitationId: undefined,
      });
      if (renewal.existingWorkspaceId) {
        existingWorkspaceIds.push(renewal.existingWorkspaceId);
      }
      continue;
    }

    const sessionPackId = await ctx.db.insert("sessionPacks", {
      userId: placeholder,
      instructorId: input.instructorId,
      totalSessions: input.sessionsPerInstructor,
      remainingSessions: input.sessionsPerInstructor,
      purchasedAt: now,
      expiresAt: input.expiresAt,
      status: "active",
      paymentId: undefined,
    });

    const seatExpiration = input.expiresAt ?? now + 90 * 24 * 60 * 60 * 1000;
    const seatReservationId = await ctx.db.insert("seatReservations", {
      instructorId: input.instructorId,
      userId: placeholder,
      sessionPackId,
      seatExpiresAt: seatExpiration,
      status: "active",
    });

    const workspaceId = await ctx.db.insert("workspaces", {
      name: `${email} × ${instructor?.name ?? instructor?.slug ?? "instructor"}`,
      description: `Mentorship workspace for ${email} with ${instructor?.name ?? input.instructorId}`,
      ownerId: placeholder,
      instructorId: input.instructorId,
      isPublic: false,
      seatReservationId,
      studentImageCount: 0,
      instructorImageCount: 0,
      type: "mentorship",
    });

    await ctx.db.insert("workspaceAuditLogs", {
      workspaceId,
      adminId: args.submittedByUserId,
      action: "create_workspace",
      details: `Auto-created via admin onboarding (source=${args.source}) by ${args.submittedByUserId} | sessionPackId=${sessionPackId} | seatReservationId=${seatReservationId} | isRenewal=false | flowVersion=1`,
      timestamp: now,
      adminOnboardingId: onboardingId,
    });

    perInstructorResults.push({
      instructorId: input.instructorId,
      workspaceId,
      seatReservationId,
      sessionPackId,
      isRenewal: false,
      sessionsPerInstructor: input.sessionsPerInstructor,
      expiresAt: input.expiresAt,
      capacityOverride: atCapacity,
      clerkInvitationId: args.clerkInvitationIds?.[input.instructorId],
    });
  }

  await ctx.db.patch(onboardingId, {
    status: "processing",
    perInstructor: perInstructorResults,
    existingWorkspaceIds,
    timeline: [
      newTimelineEntry("queued", args.submittedByUserId),
      ...(args.isSeparateStudentRecord && onboardingAlias
        ? [newTimelineEntry("alias_set", args.submittedByUserId, onboardingAlias)]
        : []),
      newTimelineEntry("processing_started", args.submittedByUserId),
    ],
  });

  return { onboardingId, perInstructor: perInstructorResults, existingWorkspaceIds };
}

/**
 * Commit the onboarding. Wraps the two-phase form's "Confirm" step:
 * inserts the `adminOnboardings` row in `queued`, sets `onboardingAlias`
 * when a Convex-only split is requested, then creates the
 * `sessionPacks` + `seatReservations` + `workspaces` (or reuses renewal
 * pairs), and patches the row to `processing`. Inngest / Resend / Discord
 * side-effects are owned by PR 3 (`appendTimelineEntry` is the seam).
 */
export const adminOnboardStudent = mutation({
  args: {
    email: v.string(),
    instructors: v.array(
      v.object({
        instructorId: v.id("instructors"),
        sessionsPerInstructor: v.number(),
        expiresAt: v.optional(v.number()),
      })
    ),
    isSeparateStudentRecord: v.optional(v.boolean()),
    notes: v.optional(v.string()),
    capacityOverrideReason: v.optional(v.string()),
    source: v.optional(
      v.union(v.literal("kajabi"), v.literal("manual"), v.literal("import"), v.literal("api"))
    ),
    clerkInvitationIds: v.optional(v.record(v.id("instructors"), v.string())),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const gate = await isAdminOrSupport(ctx, identity.subject);
    if (!gate.ok) throw new Error("Forbidden: admin or support role required");

    return await performCommit(ctx, {
      email: args.email,
      instructors: args.instructors,
      isSeparateStudentRecord: !!args.isSeparateStudentRecord,
      notes: args.notes,
      capacityOverrideReason: args.capacityOverrideReason,
      submittedByUserId: identity.subject,
      source: args.source ?? "kajabi",
      clerkInvitationIds: args.clerkInvitationIds,
    });
  },
});

/**
 * Transition a `failed` (or `queued`) onboarding back to `processing` and
 * bump `attemptCount`. Caller (the dashboard) does NOT need to know which
 * step failed — PR 3's Inngest workflow reads the attempt count and re-
 * drives from the last checkpoint.
 */
export const retryAdminOnboarding = mutation({
  args: {
    onboardingId: v.id("adminOnboardings"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const gate = await isAdminOrSupport(ctx, identity.subject);
    if (!gate.ok) throw new Error("Forbidden: admin or support role required");

    const row = await ctx.db.get(args.onboardingId);
    if (!row) throw new Error("Onboarding not found");

    if (!isAllowedTransition(row.status, "processing")) {
      throw new Error(
        `Cannot retry from status '${row.status}'; allowed transitions: ${ALLOWED_TRANSITIONS[row.status]?.join(", ") || "none"}`
      );
    }

    const now = Date.now();
    await ctx.db.patch(args.onboardingId, {
      status: "processing",
      attemptCount: row.attemptCount + 1,
      lastAttemptAt: now,
      failureReason: undefined,
      timeline: [
        ...row.timeline,
        newTimelineEntry("retrying", identity.subject, `attempt ${row.attemptCount + 1}`),
        newTimelineEntry("processing_started", identity.subject),
      ],
    });

    return { onboardingId: args.onboardingId, status: "processing" as const, attemptCount: row.attemptCount + 1 };
  },
});

/**
 * Cancel a `queued`, `processing`, or `failed` onboarding. Artifacts
 * (session packs, seats, workspaces) are preserved — the admin can audit
 * what was created and decide whether to release seats via separate
 * primitives. `cancelled` is a terminal state in the state machine.
 */
export const cancelAdminOnboarding = mutation({
  args: {
    onboardingId: v.id("adminOnboardings"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const gate = await isAdminOrSupport(ctx, identity.subject);
    if (!gate.ok) throw new Error("Forbidden: admin or support role required");

    const row = await ctx.db.get(args.onboardingId);
    if (!row) throw new Error("Onboarding not found");

    if (!isAllowedTransition(row.status, "cancelled")) {
      throw new Error(
        `Cannot cancel from status '${row.status}'; allowed transitions: ${ALLOWED_TRANSITIONS[row.status]?.join(", ") || "none"}`
      );
    }

    const now = Date.now();
    await ctx.db.patch(args.onboardingId, {
      status: "cancelled",
      cancelledAt: now,
      cancelledByUserId: identity.subject,
      timeline: [
        ...row.timeline,
        newTimelineEntry("cancelled", identity.subject, "Artifacts preserved; no automatic cleanup."),
      ],
    });

    return { onboardingId: args.onboardingId, status: "cancelled" as const };
  },
});

/**
 * Single-record read used by the detail page. Returns `null` for non-
 * admin/support identities (instead of throwing) so the UI can render a
 * "missing" state without redirecting.
 */
export const getAdminOnboarding = query({
  args: { id: v.id("adminOnboardings") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const gate = await isAdminOrSupport(ctx, identity.subject);
    if (!gate.ok) return null;
    return await ctx.db.get(args.id);
  },
});

/**
 * Auth-less read for server-to-server callers (Inngest stub + PR 3's
 * real workflow). Lives behind `getAdminOnboardingAction` so the
 * actual data access is in an `internalQuery` unreachable from the
 * browser (Greptile cloud finding: a public query with a secret
 * bypass would let any browser caller with the secret read rows).
 */
export const getAdminOnboardingInternal = internalQuery({
  args: { id: v.id("adminOnboardings") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/**
 * List view for the recovery dashboard. Indexes:
 *   - `by_status_createdAt` — fast for a single-status tab.
 *   - "all statuses" is fanned out via the same index with one bucket per
 *     status, then merged + sorted by `createdAt`.
 * `emailSearch` is a case-insensitive substring match — fine for the
 * recovery dashboard's expected volume.
 */
export const listAdminOnboardings: ReturnType<typeof query> = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("queued"),
        v.literal("processing"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("cancelled")
      )
    ),
    emailSearch: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const gate = await isAdminOrSupport(ctx, identity.subject);
    if (!gate.ok) return [];

    return await ctx.runQuery(internal.adminOnboarding.listAdminOnboardingsInternal, {
      status: args.status,
      emailSearch: args.emailSearch,
      limit: args.limit,
    });
  },
});

/**
 * Internal query: list admin onboarding rows for server-side callers
 * (e.g. the stale-digest Inngest cron). No auth-identity check — gated
 * by `CONVEX_SERVER_SHARED_SECRET` at the public-action wrapper layer.
 * Mirrors the pattern used by `getAdminOnboardingInternal` /
 * `getAdminOnboardingAction`.
 */
export const listAdminOnboardingsInternal = internalQuery({
  args: {
    status: v.optional(
      v.union(
        v.literal("queued"),
        v.literal("processing"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("cancelled")
      )
    ),
    emailSearch: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // PR 4 fix: no cap here — the public query keeps a 100-row cap for
    // safety, but server-side callers (e.g. the stale-digest cron) need
    // to scan up to the requested limit. Bounded at 1000 to defend
    // against runaway scans.
    const limit = Math.min(args.limit ?? 50, 1000);

    if (args.status) {
      const rows = await ctx.db
        .query("adminOnboardings")
        .withIndex("by_status_createdAt", (qq) => qq.eq("status", args.status!))
        .order("desc")
        .take(limit);
      return args.emailSearch
        ? rows.filter((r) => r.email.includes(args.emailSearch!.toLowerCase()))
        : rows;
    }

    // No status filter: take latest across all statuses via the same index.
    // Use the by_status_createdAt index by iterating known statuses.
    const allStatuses = ["queued", "processing", "completed", "failed", "cancelled"] as const;
    const perStatus = Math.max(1, Math.ceil(limit / allStatuses.length));
    const buckets = await Promise.all(
      allStatuses.map(async (status) =>
        ctx.db
          .query("adminOnboardings")
          .withIndex("by_status_createdAt", (qq) => qq.eq("status", status))
          .order("desc")
          .take(perStatus)
      )
    );
    const merged = buckets.flat().sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
    return args.emailSearch
      ? merged.filter((r) => r.email.includes(args.emailSearch!.toLowerCase()))
      : merged;
  },
});

/**
 * Public action wrapper for `listAdminOnboardingsInternal`. Requires
 * `CONVEX_SERVER_SHARED_SECRET` (no Clerk session — Inngest workers
 * and other server-side callers don't have one). Returns the same
 * shape as the public `listAdminOnboardings` query.
 */
export const listAdminOnboardingsAction: ReturnType<typeof action> = action({
  args: {
    status: v.optional(
      v.union(
        v.literal("queued"),
        v.literal("processing"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("cancelled")
      )
    ),
    emailSearch: v.optional(v.string()),
    limit: v.optional(v.number()),
    secret: v.string(),
  },
  handler: async (ctx, args) => {
    if (!SERVER_SHARED_SECRET || args.secret !== SERVER_SHARED_SECRET) {
      throw new Error("Unauthorized: invalid secret");
    }
    return await ctx.runQuery(
      internal.adminOnboarding.listAdminOnboardingsInternal,
      {
        status: args.status,
        emailSearch: args.emailSearch,
        limit: args.limit,
      }
    );
  },
});

/**
 * List active instructors with their current `activeStudentCount` so the
 * two-phase form can render a select with capacity hints. Capped at 500
 * — raise if the catalog grows.
 */
export const getInstructorOptionsForOnboarding = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const gate = await isAdminOrSupport(ctx, identity.subject);
    if (!gate.ok) throw new Error("Forbidden: admin or support role required");

    const instructors = await ctx.db.query("instructors").take(500);
    const active = instructors.filter(isInstructorActive);
    const results: Array<{
      id: Id<"instructors">;
      name: string | undefined;
      email: string | undefined;
      oneOnOneInventory: number | undefined;
      groupInventory: number | undefined;
      maxActiveStudents: number | undefined;
      activeStudentCount: number;
    }> = [];
    for (const instructor of active) {
      const count = await getActiveStudentCount(ctx, instructor._id);
      results.push({
        id: instructor._id,
        name: instructor.name ?? instructor.slug ?? undefined,
        email: instructor.email,
        oneOnOneInventory: instructor.oneOnOneInventory,
        groupInventory: instructor.groupInventory,
        maxActiveStudents: instructor.maxActiveStudents,
        activeStudentCount: count,
      });
    }
    results.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    return results;
  },
});

/**
 * Lightweight lookup that drives the existing-student banner on the
 * two-phase form. Reads both the `users` row and the most recent
 * `adminOnboardings` submissions for the email so the admin sees prior
 * context before clicking Preview. Distinct from `previewAdminOnboarding`
 * because the banner must render BEFORE Preview (otherwise admins would
 * not see prior submissions until after the form is mostly filled out).
 */
export const lookupExistingStudent = query({
  args: {
    email: v.string(),
  },
  handler: async (ctx, args): Promise<{
    exists: boolean;
    name: string | undefined;
    onboardingAlias: string | undefined;
    priorOnboardingIds: Id<"adminOnboardings">[];
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { exists: false, name: undefined, onboardingAlias: undefined, priorOnboardingIds: [] };
    }
    const gate = await isAdminOrSupport(ctx, identity.subject);
    if (!gate.ok) {
      return { exists: false, name: undefined, onboardingAlias: undefined, priorOnboardingIds: [] };
    }

    const email = normalizeEmail(args.email);
    if (!isValidEmail(email)) {
      return { exists: false, name: undefined, onboardingAlias: undefined, priorOnboardingIds: [] };
    }

    const userRow = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();

    const priors = await ctx.db
      .query("adminOnboardings")
      .withIndex("by_email", (q) => q.eq("email", email))
      .order("desc")
      .take(5);

    const priorOnboardingIds = priors.map((p) => p._id);

    if (!userRow) {
      return { exists: false, name: undefined, onboardingAlias: undefined, priorOnboardingIds };
    }

    const nameParts = [userRow.firstName, userRow.lastName].filter(Boolean);
    return {
      exists: true,
      name: nameParts.length > 0 ? nameParts.join(" ") : undefined,
      onboardingAlias: userRow.onboardingAlias ?? undefined,
      priorOnboardingIds,
    };
  },
});

/**
 * Internal seam used by the PR-2 stub + PR-3 real Inngest workflow to
 * append a timeline entry after each side-effect (email_sent,
 * discord_queued) and to flip the row to `completed` / `failed`. Also
 * accepts a small `emailsSent` patch so the workflow can record which
 * legs of the email fan-out succeeded without overwriting prior ticks.
 *
 * Internal because callers are server-side only — the public surface
 * is `appendTimelineEntryAction`, which validates the
 * `CONVEX_SERVER_SHARED_SECRET` and forwards into this mutation. The
 * mutation does not check Clerk auth because server-side Inngest
 * handlers don't carry a Clerk session.
 */
export const appendTimelineEntry = internalMutation({
  args: {
    onboardingId: v.id("adminOnboardings"),
    event: v.union(
      v.literal("queued"),
      v.literal("processing_started"),
      v.literal("email_sent"),
      v.literal("discord_queued"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("retrying"),
      v.literal("cancelled"),
      v.literal("capacity_override"),
      v.literal("alias_set"),
      v.literal("released")
    ),
    actorUserId: v.optional(v.string()),
    details: v.optional(v.string()),
    emailsSentPatch: v.optional(
      v.object({
        student: v.optional(v.boolean()),
        instructors: v.optional(v.array(v.id("instructors"))), // Convex instructor IDs
        adminSummary: v.optional(v.boolean()),
        stub: v.optional(v.boolean()),
      })
    ),
    expectedStatus: v.optional(v.string()),
    expectedAttemptCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.onboardingId);
    if (!row) throw new Error("Onboarding not found");
    if (
      args.expectedStatus !== undefined &&
      row.status !== args.expectedStatus
    ) {
      throw new Error(
        `appendTimelineEntry: row status is '${row.status}', expected '${args.expectedStatus}' — stale call rejected`
      );
    }
    if (
      args.expectedAttemptCount !== undefined &&
      row.attemptCount !== args.expectedAttemptCount
    ) {
      throw new Error(
        `appendTimelineEntry: row attemptCount is ${row.attemptCount}, expected ${args.expectedAttemptCount} — stale call rejected`
      );
    }
    const entry = newTimelineEntry(args.event, args.actorUserId, args.details);
    const MAX_TIMELINE = 50;
    const trimmed =
      row.timeline.length >= MAX_TIMELINE
        ? [...row.timeline.slice(-MAX_TIMELINE + 1), entry]
        : [...row.timeline, entry];
    const updates: Partial<Doc<"adminOnboardings">> = {
      timeline: trimmed,
    };
    if (args.event === "completed") {
      updates.status = "completed";
      updates.completedAt = Date.now();
    }
    if (args.event === "failed") {
      updates.status = "failed";
      updates.failureReason = args.details;
    }
    if (args.emailsSentPatch) {
      // PR 4 fix: shallow merge would replace the `instructors` array
      // entirely on each per-instructor update, so a retry would re-send
      // to all-but-the-last instructor. Concatenate + dedupe instead.
      const existingInstructors: string[] = (row.emailsSent?.instructors ?? []) as string[];
      const patchInstructors: string[] = (args.emailsSentPatch.instructors ?? []) as string[];
      const mergedInstructors = Array.from(new Set([...existingInstructors, ...patchInstructors]));
      const baseEmailsSent = { ...(row.emailsSent ?? {}), ...args.emailsSentPatch };
      updates.emailsSent = {
        ...baseEmailsSent,
        instructors: mergedInstructors,
      };
    }
    await ctx.db.patch(args.onboardingId, updates);
    return entry;
  },
});

/**
 * Public action wrapper for `appendTimelineEntry`. Mirrors the
 * `linkSessionPacksByEmailAction` pattern in `convex/sessionPacks.ts:626`:
 * requires `CONVEX_SERVER_SHARED_SECRET` in the args, then forwards to
 * the internal mutation via `ctx.runMutation`. This is the call the
 * Inngest stub (PR 2) and the real flow (PR 3) use.
 */
const SERVER_SHARED_SECRET = process.env.CONVEX_SERVER_SHARED_SECRET;

export const appendTimelineEntryAction = action({
  args: {
    onboardingId: v.id("adminOnboardings"),
    event: v.union(
      v.literal("queued"),
      v.literal("processing_started"),
      v.literal("email_sent"),
      v.literal("discord_queued"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("retrying"),
      v.literal("cancelled"),
      v.literal("capacity_override"),
      v.literal("alias_set"),
      v.literal("released")
    ),
    actorUserId: v.optional(v.string()),
    details: v.optional(v.string()),
    emailsSentPatch: v.optional(
      v.object({
        student: v.optional(v.boolean()),
        instructors: v.optional(v.array(v.id("instructors"))), // Convex instructor IDs
        adminSummary: v.optional(v.boolean()),
        stub: v.optional(v.boolean()),
      })
    ),
    expectedStatus: v.optional(v.string()),
    expectedAttemptCount: v.optional(v.number()),
    secret: v.string(),
  },
  handler: async (ctx, args) => {
    if (!SERVER_SHARED_SECRET || args.secret !== SERVER_SHARED_SECRET) {
      throw new Error("Unauthorized: invalid secret");
    }
    const result: Doc<"adminOnboardings">["timeline"][number] = await ctx.runMutation(
      internal.adminOnboarding.appendTimelineEntry,
      {
        onboardingId: args.onboardingId,
        event: args.event,
        actorUserId: args.actorUserId,
        details: args.details,
        emailsSentPatch: args.emailsSentPatch,
        expectedStatus: args.expectedStatus,
        expectedAttemptCount: args.expectedAttemptCount,
      }
    );
    return result;
  },
});

/**
 * Public action wrapper for `getAdminOnboardingInternal`. Mirrors the
 * `appendTimelineEntryAction` pattern (defined above): requires
 * `CONVEX_SERVER_SHARED_SECRET`, then delegates to the internal query.
 *
 * The explicit `ReturnType<typeof action>` annotation breaks a
 * circular-inference cycle that arises when the action's return type
 * is inferred via `internal.adminOnboarding.getAdminOnboardingInternal`
 * — TypeScript gets stuck resolving the generated API types within
 * the same module context. The annotation erases the inner generic
 * but preserves the public type contract via the generated API.
 * Callable from external clients (Inngest worker, server-side fetch).
 */
export const getAdminOnboardingAction: ReturnType<typeof action> = action({
  args: {
    id: v.id("adminOnboardings"),
    secret: v.string(),
  },
  handler: async (ctx, args) => {
    if (!SERVER_SHARED_SECRET || args.secret !== SERVER_SHARED_SECRET) {
      throw new Error("Unauthorized: invalid secret");
    }
    return await ctx.runQuery(
      internal.adminOnboarding.getAdminOnboardingInternal,
      { id: args.id }
    );
  },
});

/**
 * Internal mutation: release placeholder inventory held by an admin
 * onboarding row. For each entry in `perInstructor`, patches:
 *   - `seatReservations.status = "released"` (idempotent — skipped if already)
 *   - `workspaces.endedAt = now`        (idempotent — skipped if already set)
 *   - `sessionPacks.status = "expired"` (idempotent — skipped if not active)
 *
 * Appends a single `released` timeline entry on success. Does NOT
 * transition `adminOnboardings.status` (the schema does not have a
 * "released" status — release is a sub-event of `completed`).
 *
 * This is the action the PR 4 stale-digest flow calls to make the
 * `released` timeline event meaningful (previously, the event was
 * written but no inventory state changed).
 */
export const releasePlaceholderInventoryInternal = internalMutation({
  args: {
    onboardingId: v.id("adminOnboardings"),
    actorUserId: v.optional(v.string()),
    details: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.onboardingId);
    if (!row) throw new Error("Onboarding row not found: " + args.onboardingId);

    const now = Date.now();
    let seatsReleased = 0;
    let workspacesEnded = 0;
    let packsExpired = 0;
    let skipped = 0;

    for (const entry of row.perInstructor) {
      // 1. Release placeholder seat reservation.
      if (entry.seatReservationId) {
        const seat = await ctx.db.get(entry.seatReservationId);
        if (seat && seat.status !== "released") {
          await ctx.db.patch(entry.seatReservationId, { status: "released" });
          seatsReleased++;
        } else {
          skipped++;
        }
      }

      // 2. End any workspace that was auto-created by this onboarding
      //    (only newly-created workspaces, not reused renewals). Renewal
      //    pairs leave `workspaceId` undefined.
      if (entry.workspaceId) {
        const ws = await ctx.db.get(entry.workspaceId);
        if (ws && ws.endedAt === undefined && ws.deletedAt === undefined) {
          await ctx.db.patch(entry.workspaceId, { endedAt: now });
          workspacesEnded++;
        }
      }

      // 3. Expire the placeholder session pack (mirror `expireSessionPack`
      //    in `convex/sessionPacks.ts:336` — schema has no `cancelled`).
      //    PR 4 fix: skip packs whose userId has been rewritten to a
      //    real Clerk ID — those are live in-use packs the student
      //    owns, and we must not revoke their access. Placeholder packs
      //    always have userId starting with "email:" (set during
      //    admin onboarding); real users use Clerk IDs.
      if (entry.sessionPackId) {
        const pack = await ctx.db.get(entry.sessionPackId);
        if (pack && pack.status === "active" && typeof pack.userId === "string" && pack.userId.startsWith("email:")) {
          await ctx.db.patch(entry.sessionPackId, { status: "expired" });
          packsExpired++;
        } else if (pack && pack.status === "active") {
          skipped++;
        }
      }
    }

    // Append a single "released" timeline entry. Idempotent on
    // `appendTimelineEntry` itself — if the event already exists in the
    // bounded timeline, no double-append occurs.
    await ctx.runMutation(internal.adminOnboarding.appendTimelineEntry, {
      onboardingId: args.onboardingId,
      event: "released",
      actorUserId: args.actorUserId,
      details:
        (args.details ? args.details + " | " : "") +
        "seats=" + seatsReleased +
        ",workspaces=" + workspacesEnded +
        ",packs=" + packsExpired +
        ",skipped=" + skipped,
      expectedStatus: undefined,
      expectedAttemptCount: undefined,
    });

    return {
      releasedCount: seatsReleased + workspacesEnded + packsExpired,
      seatsReleased,
      workspacesEnded,
      packsExpired,
      skipped,
    };
  },
});

/**
 * Public action wrapper for `releasePlaceholderInventoryInternal`.
 * Mirrors the `appendTimelineEntryAction` pattern: requires
 * `CONVEX_SERVER_SHARED_SECRET`, then delegates to the internal
 * mutation via `ctx.runMutation`. Called from the PR 4 stale-digest
 * Inngest flow after `scan-stale` identifies stale rows.
 */
export const releasePlaceholderInventoryAction: ReturnType<typeof action> = action({
  args: {
    onboardingId: v.id("adminOnboardings"),
    actorUserId: v.optional(v.string()),
    details: v.optional(v.string()),
    secret: v.string(),
  },
  handler: async (ctx, args) => {
    if (!SERVER_SHARED_SECRET || args.secret !== SERVER_SHARED_SECRET) {
      throw new Error("Unauthorized: invalid secret");
    }
    return await ctx.runMutation(
      internal.adminOnboarding.releasePlaceholderInventoryInternal,
      {
        onboardingId: args.onboardingId,
        actorUserId: args.actorUserId,
        details: args.details,
      }
    );
  },
});

/**
 * Internal query: resolve contact info (email + name) for multiple
 * instructors. Used by the admin onboarding flow to fill in the
 * `instructorName` field on every email step (student, instructor,
 * admin) — previously hardcoded to "" or "Instructor", which made
 * every admin-onboarded email show blank names (Greptile P1).
 *
 * Email resolution order (per instructor):
 *   1. `instructors.email` (direct field on the instructor row)
 *   2. `users.email` via `instructors.userId` (cross-reference)
 *
 * Name resolution:
 *   1. `instructors.name` (always present — schema line 60 is `v.string()`)
 *   2. fall back to `instructors.slug` if name is empty
 *
 * Returns a map keyed by instructor ID. Missing rows are omitted
 * from the map (callers should treat as "instructor_not_found").
 */
export const getInstructorContactsInternal = internalQuery({
  args: {
    instructorIds: v.array(v.id("instructors")),
  },
  handler: async (ctx, args) => {
    const result: Record<string, { email: string | null; name: string; reason: string | null }> = {};
    for (const id of args.instructorIds) {
      const instructor = await ctx.db.get(id);
      if (!instructor) {
        result[id] = { email: null, name: "", reason: "instructor_not_found" };
        continue;
      }
      const name = instructor.name && instructor.name.length > 0
        ? instructor.name
        : (instructor.slug ?? "");
      let email: string | null = null;
      let reason: string | null = null;
      if (instructor.email && instructor.email.length > 0) {
        email = instructor.email;
      } else if (instructor.userId) {
        const user = await ctx.db
          .query("users")
          .withIndex("by_userId", (q) => q.eq("userId", instructor.userId!))
          .first();
        if (user && user.email) {
          email = user.email;
        } else {
          reason = "no_email";
        }
      } else {
        reason = "no_email";
      }
      result[id] = { email, name, reason };
    }
    return result;
  },
});

/**
 * Public action wrapper for `getInstructorContactsInternal`.
 * Mirrors the `appendTimelineEntryAction` pattern: requires
 * `CONVEX_SERVER_SHARED_SECRET`, then delegates to the internal query.
 */
export const getInstructorContactsAction: ReturnType<typeof action> = action({
  args: {
    instructorIds: v.array(v.id("instructors")),
    secret: v.string(),
  },
  handler: async (ctx, args) => {
    if (!SERVER_SHARED_SECRET || args.secret !== SERVER_SHARED_SECRET) {
      throw new Error("Unauthorized: invalid secret");
    }
    return await ctx.runQuery(
      internal.adminOnboarding.getInstructorContactsInternal,
      { instructorIds: args.instructorIds }
    );
  },
});
