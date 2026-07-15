import { query, mutation, internalMutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";

const ALLOWED_TRANSITIONS: Record<string, ReadonlyArray<string>> = {
  queued: ["processing", "cancelled"],
  processing: ["completed", "failed", "cancelled"],
  failed: ["processing", "cancelled"],
  cancelled: [],
  completed: [],
};

function isAllowedTransition(from: string, to: string): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

function generateAlias(): string {
  // Deterministic enough for indexing; unique enough for in-process use.
  // crypto.randomUUID() is supported in modern Convex runtimes, but we
  // keep this portable across any future runtime swap.
  const rand = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
  const time = Date.now().toString(36);
  return `alias_${time}_${rand}`;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  // Lightweight validation; Convex API routes do their own zod check.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isInstructorActive(instructor: Doc<"instructors"> | null): boolean {
  if (!instructor) return false;
  if (instructor.deletedAt) return false;
  if (instructor.isActive === false) return false;
  return true;
}

async function detectRenewal(
  ctx: QueryCtx,
  email: string,
  instructorId: Id<"instructors">
): Promise<{
  isRenewal: boolean;
  existingSeatId?: Id<"seatReservations">;
  existingWorkspaceId?: Id<"workspaces">;
}> {
  const placeholder = `email:${email}`;
  const seat = await ctx.db
    .query("seatReservations")
    .withIndex("by_userId_instructorId", (q) =>
      q.eq("userId", placeholder).eq("instructorId", instructorId)
    )
    .first();
  if (!seat || seat.status === "released") {
    return { isRenewal: false };
  }
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

    await ctx.db.patch(seatReservationId, {});

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
    });
  },
});

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

export const listAdminOnboardings = query({
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

    const limit = Math.min(args.limit ?? 50, 100);

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
      v.literal("alias_set")
    ),
    actorUserId: v.optional(v.string()),
    details: v.optional(v.string()),
    emailsSentPatch: v.optional(
      v.object({
        student: v.optional(v.boolean()),
        instructors: v.optional(v.array(v.string())),
        adminSummary: v.optional(v.boolean()),
        stub: v.optional(v.boolean()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.onboardingId);
    if (!row) throw new Error("Onboarding not found");
    const entry = newTimelineEntry(args.event, args.actorUserId, args.details);
    const updates: Partial<Doc<"adminOnboardings">> = {
      timeline: [...row.timeline, entry],
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
      updates.emailsSent = { ...(row.emailsSent ?? {}), ...args.emailsSentPatch };
    }
    await ctx.db.patch(args.onboardingId, updates);
    return entry;
  },
});
