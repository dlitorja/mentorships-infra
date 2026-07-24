import { query, mutation, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { MutationCtx, QueryCtx, ActionCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { isStaleOnboardingRow } from "../apps/platform/lib/admin-onboarding/stale-onboarding-filter";
import { mergeEmailsSentPatch } from "../apps/platform/lib/admin-onboarding/emails-sent-merge";
import { emailsSentPatchForRecipient, type MarkEmailSentRecipient } from "../apps/platform/lib/admin-onboarding/mark-email-sent-recipient";
import { writeAuditLog } from "./auditLog";

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

    const result = await performCommit(ctx, {
      email: args.email,
      instructors: args.instructors,
      isSeparateStudentRecord: !!args.isSeparateStudentRecord,
      notes: args.notes,
      capacityOverrideReason: args.capacityOverrideReason,
      submittedByUserId: identity.subject,
      source: args.source ?? "kajabi",
      clerkInvitationIds: args.clerkInvitationIds,
    });

    await writeAuditLog(ctx, {
      actorId: identity.subject,
      actorRole: gate.role,
      action: "admin_onboard_student",
      targetType: "adminOnboarding",
      targetId: result.onboardingId,
      details: `Onboarded ${args.email} with ${args.instructors.length} instructor(s)`,
      metadata: {
        email: args.email,
        instructorCount: args.instructors.length,
        source: args.source ?? "kajabi",
        isSeparateStudentRecord: !!args.isSeparateStudentRecord,
        capacityOverrideReason: args.capacityOverrideReason ?? null,
      },
    });

    return result;
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

    const previousStatus = row.status;
    const now = Date.now();
    const newAttemptCount = row.attemptCount + 1;
    await ctx.db.patch(args.onboardingId, {
      status: "processing",
      attemptCount: newAttemptCount,
      lastAttemptAt: now,
      failureReason: undefined,
      timeline: [
        ...row.timeline,
        newTimelineEntry("retrying", identity.subject, `attempt ${newAttemptCount}`),
        newTimelineEntry("processing_started", identity.subject),
      ],
    });

    await writeAuditLog(ctx, {
      actorId: identity.subject,
      actorRole: gate.role,
      action: "retry_admin_onboarding",
      targetType: "adminOnboarding",
      targetId: args.onboardingId,
      details: `Retried onboarding (was: ${previousStatus}, attempt: ${newAttemptCount})`,
      metadata: { previousStatus, newAttemptCount, email: row.email },
    });

    return { onboardingId: args.onboardingId, status: "processing" as const, attemptCount: newAttemptCount };
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

    const previousStatus = row.status;
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

    await writeAuditLog(ctx, {
      actorId: identity.subject,
      actorRole: gate.role,
      action: "cancel_admin_onboarding",
      targetType: "adminOnboarding",
      targetId: args.onboardingId,
      details: `Cancelled onboarding (was: ${previousStatus})`,
      metadata: { previousStatus, email: row.email },
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
 * real workflow). Public surface is the bearer-auth HTTP endpoint at
 * `POST /admin-onboarding/get` (CONVEX_HTTP_KEY bearer, see
 * `convex/http.ts:httpGetAdminOnboarding`) so the actual data access
 * is in an `internalQuery` unreachable from the browser. Clerk-gated
 * browser callers use the public `getAdminOnboarding` query.
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
 * `emailSearch` and `instructorSearch` are case-insensitive substring
 * matches against the row's email or any per-instructor name (joined
 * via `ctx.db.get`). Fine for the recovery dashboard's expected volume
 * (cap of 1000 rows).
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
    instructorSearch: v.optional(v.string()),
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
      instructorSearch: args.instructorSearch,
      limit: args.limit,
    });
  },
});

/**
 * Internal query: list admin onboarding rows for server-side callers
 * (e.g. the stale-digest Inngest cron, the admin list view). No
 * auth-identity check — the public surface is the bearer-auth HTTP
 * endpoint at `POST /admin-onboarding/list` (CONVEX_HTTP_KEY bearer,
 * see `convex/http.ts:httpListAdminOnboardings`). Clerk-gated browser
 * callers use the public `listAdminOnboardings` query.
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
    instructorSearch: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // PR 4 fix: no cap here — the public query keeps a 100-row cap for
    // safety, but server-side callers (e.g. the stale-digest cron) need
    // to scan up to the requested limit. Bounded at 1000 to defend
    // against runaway scans.
    const limit = Math.min(args.limit ?? 50, 1000);

    const emailQ = args.emailSearch?.toLowerCase();
    const instructorQ = args.instructorSearch?.toLowerCase();

    const fetchRows = async () => {
      if (args.status) {
        return await ctx.db
          .query("adminOnboardings")
          .withIndex("by_status_createdAt", (qq) => qq.eq("status", args.status!))
          .order("desc")
          .take(limit);
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
      return buckets
        .flat()
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);
    };

    const rows = await fetchRows();

    // PR 11: enrich each row with `instructorNames` (denormalized via
    // ctx.db.get on the `instructors` table) so the list page can sort
    // and filter by instructor name without a separate per-row query.
    // Bounded at the row count (≤1000) × perInstructor length. Parallel
    // `ctx.db.get` keeps it cheap.
    const enriched = await Promise.all(
      rows.map(async (row) => {
        const names = await Promise.all(
          row.perInstructor.map(async (p) => {
            const inst = await ctx.db.get(p.instructorId);
            return inst?.name ?? "";
          })
        );
        return { ...row, instructorNames: names.filter((n) => n.length > 0) };
      })
    );

    // When NEITHER filter is provided, return all enriched rows.
    if (!emailQ && !instructorQ) return enriched;

    // When at least one filter is provided, apply as a UNION (OR) so a
    // row matches if either the email OR any per-instructor name contains
    // the query. The missing-side default of `true` is what makes this
    // work — when only one filter is provided, the other side is a
    // no-op so the OR reduces to the single check.
    return enriched.filter((r) => {
      const emailHit = emailQ ? r.email.toLowerCase().includes(emailQ) : true;
      const instructorHit = instructorQ
        ? r.instructorNames.some((n) => n.toLowerCase().includes(instructorQ))
        : true;
      return emailHit || instructorHit;
    });
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
 * is the bearer-auth HTTP endpoint at `POST /admin-onboarding/append-timeline`
 * (CONVEX_HTTP_KEY bearer, see `convex/http.ts:httpAppendTimelineEntry`).
 * The mutation does not check Clerk auth because server-side Inngest
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
        // PR 4 cloud-review fix: per-address admin-send tracking.
        adminSummaryByEmail: v.optional(v.record(v.string(), v.boolean())),
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
      // R7 (PR 8): merge logic delegated to the pure helper
      // `mergeEmailsSentPatch` in
      // `apps/platform/lib/admin-onboarding/emails-sent-merge.ts` so
      // the concat+dedupe and keyed-merge invariants are
      // unit-testable in isolation.
      updates.emailsSent = mergeEmailsSentPatch(
        row.emailsSent as
          | {
              student?: boolean;
              instructors?: readonly string[];
              adminSummary?: boolean;
              adminSummaryByEmail?: Readonly<Record<string, boolean>>;
              stub?: boolean;
            }
          | null
          | undefined,
        args.emailsSentPatch,
      ) as Doc<"adminOnboardings">["emailsSent"];
    }
    await ctx.db.patch(args.onboardingId, updates);
    // PR B: audit row written in the same mutation as the timeline
    // entry, so the data write and the audit row commit atomically.
    // The bearer-auth `/admin-onboarding/append-timeline` HTTP
    // endpoint in `convex/http.ts` is the only caller of this mutation
    // (the legacy `appendTimelineEntryAction` public wrapper was
    // removed in PR C once all consumers had migrated to the HTTP
    // bearer-auth transport during the PR B WIDEN window).
    await writeAuditLog(ctx, {
      actorId: "platform-server",
      actorRole: "system",
      action: "append_timeline_entry_admin_onboarding",
      targetType: "adminOnboarding",
      targetId: args.onboardingId,
      details: `event=${args.event}` + (args.actorUserId ? ` actor=${args.actorUserId}` : ""),
      metadata: {
        event: args.event,
        actorUserId: args.actorUserId ?? null,
        expectedStatus: args.expectedStatus ?? null,
        expectedAttemptCount: args.expectedAttemptCount ?? null,
      },
    });
    return entry;
  },
});

/**
 * R5 (PR 14): semantic helper for the per-recipient email-send tick
 * (step 2: student, step 3: instructor, step 4c per-address if ever
 * migrated from aggregate). Wraps `appendTimelineEntry` so callers say
 * "what was sent" via a discriminated-union `recipient` arg instead of
 * constructing the underlying `emailsSentPatch` shape by hand.
 *
 * Behavior:
 *   - Maps `recipient` -> `emailsSentPatch` via
 *     `emailsSentPatchForRecipient` (unit-tested in
 *     `apps/platform/lib/admin-onboarding/mark-email-sent-recipient.test.ts`).
 *   - Appends a `{ event: "email_sent", details: <JSON of recipient+metadata> }`
 *     timeline entry.
 *   - Performs the same `expectedStatus` / `expectedAttemptCount` stale
 *     guards as `appendTimelineEntry` -- re-fetching logic in step 2 / 3
 *     already checks these; the guard inside this mutation is the
 *     second line of defense against a stale call landing after a newer
 *     attempt took ownership.
 *   - Returns the new timeline entry (same return type as
 *     `appendTimelineEntry`).
 *
 * Why this is additive, not a replacement:
 *   - `appendTimelineEntry` continues to support arbitrary events
 *     (discord_queued, completed, failed, released, ...) and arbitrary
 *     patch shapes. Those callers (step 5, step 6, mark-failed catch,
 *     `releasePlaceholderInventoryInternal`, ...) are unaffected.
 *   - `markEmailSent` is the canonical way for the three per-recipient
 *     send legs to record their tick.
 *
 * Why this delegates to `appendTimelineEntry` instead of re-implementing
 * the merge:
 *   - The merge logic (instructor concat+dedupe, adminSummaryByEmail
 *     keyed merge, top-level shallow patch) is single-source-of-truth
 *     in `appendTimelineEntry` + `mergeEmailsSentPatch`. Delegating
 *     keeps `markEmailSent` tiny and prevents drift between the two
 *     paths.
 *
 * `reason` arg:
 *   - For the no-email / no-config instructor-skip path, the previous
 *     public-action caller (now removed in PR C) used to pass a
 *     bespoke `details.reason` ("no_email" / "missing_config").
 *     `reason` is preserved here so the timeline stays informative
 *     for on-call.
 *   - For other paths, leave `reason` unset (omitted from details JSON).
 */
export const markEmailSent = internalMutation({
  args: {
    onboardingId: v.id("adminOnboardings"),
    recipient: v.union(
      v.object({ kind: v.literal("student") }),
      v.object({ kind: v.literal("instructor"), instructorId: v.id("instructors") }),
      v.object({ kind: v.literal("adminSummary"), email: v.string() }),
    ),
    resendMessageId: v.optional(v.string()),
    skipped: v.optional(v.boolean()),
    reason: v.optional(v.string()),
    actorUserId: v.optional(v.string()),
    expectedStatus: v.optional(v.literal("processing")),
    expectedAttemptCount: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Doc<"adminOnboardings">["timeline"][number]> => {
    // Stale-call guard: same semantics as `appendTimelineEntry`. If a
    // newer attempt has already taken ownership of the row (status
    // changed away from "processing" or attemptCount incremented), throw
    // so Inngest's step.run marks the step as failed and the catch
    // block surfaces the outcome (suppress digest / send informational
    // digest / non-retriable error, depending on the row's terminal
    // state -- see `onboarding.ts` mark-failed catch logic).
    const row = await ctx.db.get(args.onboardingId);
    if (!row) throw new Error("markEmailSent: onboarding not found");
    if (
      args.expectedStatus !== undefined &&
      row.status !== args.expectedStatus
    ) {
      throw new Error(
        `markEmailSent: row status is '${row.status}', expected '${args.expectedStatus}' -- stale call rejected`,
      );
    }
    if (
      args.expectedAttemptCount !== undefined &&
      row.attemptCount !== args.expectedAttemptCount
    ) {
      throw new Error(
        `markEmailSent: row attemptCount is ${row.attemptCount}, expected ${args.expectedAttemptCount} -- stale call rejected`,
      );
    }

    const recipient = args.recipient as MarkEmailSentRecipient;
    const detailsPayload: Record<string, unknown> = { recipient: recipient.kind };
    if (recipient.kind === "instructor") {
      detailsPayload.instructorId = recipient.instructorId;
    } else if (recipient.kind === "adminSummary") {
      detailsPayload.email = recipient.email;
    }
    if (args.resendMessageId !== undefined) detailsPayload.resendMessageId = args.resendMessageId;
    if (args.skipped !== undefined) detailsPayload.skipped = args.skipped;
    if (args.reason !== undefined) detailsPayload.reason = args.reason;

    const entry = await ctx.runMutation(internal.adminOnboarding.appendTimelineEntry, {
      onboardingId: args.onboardingId,
      event: "email_sent",
      actorUserId: args.actorUserId,
      details: JSON.stringify(detailsPayload),
      emailsSentPatch: emailsSentPatchForRecipient(recipient),
      expectedStatus: args.expectedStatus,
      expectedAttemptCount: args.expectedAttemptCount,
    });
    // PR B: audit row written after the timeline append succeeds.
    // The bearer-auth `/admin-onboarding/mark-email-sent` HTTP
    // endpoint in `convex/http.ts` is the only caller of this mutation
    // (the legacy `markEmailSentAction` public wrapper was removed in
    // PR C once all consumers had migrated to the HTTP bearer-auth
    // transport during the PR B WIDEN window). The
    // `append_timeline_entry_admin_onboarding` audit row written by the
    // inner `appendTimelineEntry` mutation is the dual record of the
    // same logical event.
    await writeAuditLog(ctx, {
      actorId: "platform-server",
      actorRole: "system",
      action: "mark_email_sent_admin_onboarding",
      targetType: "adminOnboarding",
      targetId: args.onboardingId,
      details: `recipient=${recipient.kind}` + (args.skipped ? " skipped" : ""),
      metadata: {
        recipient: recipient.kind,
        instructorId: recipient.kind === "instructor" ? recipient.instructorId : null,
        adminEmail: recipient.kind === "adminSummary" ? recipient.email : null,
        resendMessageId: args.resendMessageId ?? null,
        skipped: args.skipped ?? false,
        reason: args.reason ?? null,
      },
    });
    return entry;
  },
});

/**
 * Shared per-row release logic used by both `releasePlaceholderInventoryInternal`
 * (single-row) and `releasePlaceholderInventoryBatchInternal`
 * (multi-row, batched). PR 16 (R11) extraction so the batch caller
 * doesn't duplicate the placeholder guards (seat.userId.startsWith("email:"),
 * workspace ownerId guard, sessionPack userId guard) or the
 * timeline-append bookkeeping.
 *
 * Returns per-row counters; the batch caller aggregates them.
 */
async function releaseInventoryForRow(
  ctx: MutationCtx,
  args: {
    onboardingId: Id<"adminOnboardings">;
    actorUserId?: string | undefined;
    details?: string | undefined;
  }
): Promise<{
  releasedCount: number;
  seatsReleased: number;
  workspacesEnded: number;
  packsExpired: number;
  skipped: number;
}> {
  const row = await ctx.db.get(args.onboardingId);
  if (!row) throw new Error("Onboarding row not found: " + args.onboardingId);

  const now = Date.now();
  let seatsReleased = 0;
  let workspacesEnded = 0;
  let packsExpired = 0;
  let skipped = 0;

  for (const entry of row.perInstructor) {
    // 1. Release placeholder seat reservation.
    //    PR 4 cloud-review fix (greptile-apps): skip seats whose userId
    //    has been rewritten to a real Clerk ID — those are now owned by
    //    a real student, and releasing the seat would orphan their
    //    allocation. Placeholder seat reservations always have userId
    //    starting with "email:" (set during admin onboarding); real
    //    users use Clerk IDs.
    if (entry.seatReservationId) {
      const seat = await ctx.db.get(entry.seatReservationId);
      if (seat && seat.status !== "released") {
        if (typeof seat.userId === "string" && seat.userId.startsWith("email:")) {
          await ctx.db.patch(entry.seatReservationId, { status: "released" });
          seatsReleased++;
        } else {
          skipped++;
        }
      } else {
        skipped++;
      }
    }

    // 2. End any workspace that was auto-created by this onboarding
    //    (only newly-created workspaces, not reused renewals). Renewal
    //    pairs leave `workspaceId` undefined.
    //    PR 4 cloud-review fix (greptile-apps): also guard on
    //    `ownerId.startsWith("email:")` so we never end a workspace
    //    whose owner has been rewritten to a real Clerk ID by the
    //    linking flow.
    if (entry.workspaceId) {
      const ws = await ctx.db.get(entry.workspaceId);
      if (ws && ws.endedAt === undefined && ws.deletedAt === undefined && typeof ws.ownerId === "string" && ws.ownerId.startsWith("email:")) {
        await ctx.db.patch(entry.workspaceId, { endedAt: now });
        workspacesEnded++;
      } else if (ws && ws.endedAt === undefined && ws.deletedAt === undefined) {
        skipped++;
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

  // PR B: audit row written after the seat/workspace/pack patches
  // and the timeline append succeed. The audit fires once per
  // onboardingId, regardless of whether the caller is the single-row
  // `releasePlaceholderInventoryInternal` or the batched
  // `releasePlaceholderInventoryBatchInternal` (both call this
  // helper). The `append_timeline_entry_admin_onboarding` audit row
  // written by the inner `appendTimelineEntry` mutation is the dual
  // record of the timeline event.
  await writeAuditLog(ctx, {
    actorId: "platform-server",
    actorRole: "system",
    action: "release_placeholder_inventory_admin_onboarding",
    targetType: "adminOnboarding",
    targetId: args.onboardingId,
    details:
      "seats=" + seatsReleased +
      ",workspaces=" + workspacesEnded +
      ",packs=" + packsExpired +
      ",skipped=" + skipped,
    metadata: {
      seatsReleased,
      workspacesEnded,
      packsExpired,
      skipped,
      actorUserId: args.actorUserId ?? null,
      source: args.details ?? null,
    },
  });

  return {
    releasedCount: seatsReleased + workspacesEnded + packsExpired,
    seatsReleased,
    workspacesEnded,
    packsExpired,
    skipped,
  };
}

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
    return await releaseInventoryForRow(ctx, args);
  },
});

/**
 * Internal mutation: batched release of placeholder inventory for
 * multiple admin onboarding rows in a single Convex transaction.
 * PR 16 (R11) consolidation — replaces the N-times-`ctx.runMutation`
 * pattern in `apps/platform/inngest/functions/admin-onboarding-stale-digest.ts`
 * with one transaction that loops per-row.
 *
 * Per-row errors are caught and reported via the timeline so a single
 * bad row never aborts the batch (matches the existing per-row
 * try/catch in the Inngest flow). Aggregate counters are returned for
 * observability.
 *
 * Bounded to ~50 onboardings per call by the Inngest caller; the
 * paginated scan yields a flat list which the caller chunks before
 * dispatching.
 */
export const releasePlaceholderInventoryBatchInternal = internalMutation({
  args: {
    onboardingIds: v.array(v.id("adminOnboardings")),
    actorUserId: v.optional(v.string()),
    details: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let onboardingsProcessed = 0;
    let onboardingsSkipped = 0;
    let totalSeatsReleased = 0;
    let totalWorkspacesEnded = 0;
    let totalPacksExpired = 0;
    let totalSkipped = 0;
    const failedOnboardingIds: Id<"adminOnboardings">[] = [];

    for (const onboardingId of args.onboardingIds) {
      try {
        const result = await releaseInventoryForRow(ctx, {
          onboardingId,
          actorUserId: args.actorUserId,
          details: args.details,
        });
        if (result.releasedCount > 0) {
          onboardingsProcessed++;
        } else {
          onboardingsSkipped++;
        }
        totalSeatsReleased += result.seatsReleased;
        totalWorkspacesEnded += result.workspacesEnded;
        totalPacksExpired += result.packsExpired;
        totalSkipped += result.skipped;
      } catch (err) {
        // Per-row defensive: a missing/deleted row or a transient
        // patch failure must not abort the rest of the batch. The
        // failed ID is recorded so the Inngest caller can surface it
        // through the existing observability path (matches the
        // pre-PR-16 per-row `reportError` behavior).
        onboardingsSkipped++;
        failedOnboardingIds.push(onboardingId);
        console.error(
          "releasePlaceholderInventoryBatchInternal: row failed",
          {
            onboardingId,
            error: err instanceof Error ? err.message : String(err),
          }
        );
      }
    }

    return {
      onboardingsProcessed,
      onboardingsSkipped,
      totalSeatsReleased,
      totalWorkspacesEnded,
      totalPacksExpired,
      totalSkipped,
      failedOnboardingIds,
    };
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
 * Internal query: scan completed admin onboardings that have stale
 * placeholder inventory and are still genuinely un-claimed by a real
 * Clerk user. Used by the daily stale-digest cron (`adminOnboardingStaleDigestFlow`).
 *
 * Server-side does the heavy lifting (one DB scan + per-row pack lookup)
 * so the Inngest caller can simply iterate over the returned rows.
 *
 * "Placeholder" verification mirrors `releasePlaceholderInventoryInternal`:
 * the row's `perInstructor[i].sessionPackId` must point to a pack whose
 * `userId` still starts with "email:" AND `status === "active"`. This
 * protects the digest from producing false alerts for onboardings whose
 * students have already accepted their invites but where the linking
 * flow hasn't yet rewritten the pack owner.
 *
 * PR 4 cloud-review fix (CodeRabbit #9214): ownership verification happens
 * at scan time, not only at release time, so admins don't get repeated
 * alerts for onboardings whose placeholder has been claimed.
 *
 * R3 (PR 7): switched from `.take(1000)` to `.paginate(paginationOpts)` so
 * the daily cron can iterate past 1000 stale rows. The Inngest handler
 * (`paginateStaleOnboardings`) bounds the total scan at 10,000 rows per
 * run as a safety cap; the remaining tail surfaces as a `truncated: true`
 * flag so monitoring can detect a sustained backlog.
 */
export const getStaleOnboardingsInternal = internalQuery({
  args: {
    cutoffMs: v.number(),
    paginationOpts: v.any(),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("adminOnboardings")
      .withIndex("by_status_createdAt", (q) => q.eq("status", "completed"))
      .order("desc")
      .paginate(args.paginationOpts);

    // R7 (PR 8): per-row filter logic is delegated to the pure helper
    // `isStaleOnboardingRow` in
    // `apps/platform/lib/admin-onboarding/stale-onboarding-filter.ts` so
    // the semantics are unit-testable without a live database.
    const fetchPack: (id: string) => Promise<
      { status?: string | null; userId?: string | null } | null
    > = (id) =>
      ctx.db.get(id as Id<"sessionPacks">) as Promise<
        { status?: string | null; userId?: string | null } | null
      >;
    const staleRows: Doc<"adminOnboardings">[] = [];
    for (const row of page.page) {
      if (
        await isStaleOnboardingRow(
          {
            createdAt: row.createdAt,
            email: row.email,
            perInstructor: row.perInstructor,
          },
          args.cutoffMs,
          fetchPack,
        )
      ) {
        staleRows.push(row);
      }
    }
    return {
      rows: staleRows,
      continueCursor: page.isDone ? null : page.continueCursor,
      isDone: page.isDone,
    };
  },
});
