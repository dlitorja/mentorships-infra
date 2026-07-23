import { internalMutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

/**
 * Audit log table for admin (and other actor) actions.
 *
 * Scope:
 *   - Cross-cutting audit table for mutations that change user-visible
 *     state across many tables (role changes, refunds, onboarding
 *     commit/retry/cancel, hd invitation lifecycle, instructor create /
 *     deactivate, etc).
 *   - Distinct from `workspaceAuditLogs` (workspace-only) and the
 *     per-onboarding `adminOnboardings.timeline` (append-only event log).
 *
 * Read shape:
 *   - Paginated admin read via `listAuditLogs`. Filters by actor,
 *     action, targetType. Returns newest-first.
 *
 * Write shape:
 *   - In-mutation helper `writeAuditLog` so existing admin mutations
 *     can add one line at the end of their handler.
 *   - Cross-call internal mutation `recordAuditLog` for callers that
 *     need to write from outside a Convex mutation (e.g., the platform
 *     admin routes after the shared-secret PR removes HMAC, or the
 *     Inngest worker if it ever needs to record admin-shaped actions).
 *
 * Backwards compatibility:
 *   - `workspaceAuditLogs` is NOT migrated. Workspace-only mutations
 *     continue to use that table; cross-cutting mutations use this
 *     one. A follow-up could unify them.
 *
 * Why `actorRole` is optional:
 *   - System actors (cron, internal migrations, admin-UI automation)
 *     have no role. Recording `actorRole: undefined` for them keeps
 *     the column accurate without forcing a sentinel value.
 */
export type AuditLogActorRole =
  | "admin"
  | "support"
  | "instructor"
  | "student"
  | "system";

export type AuditLogWriteArgs = {
  actorId: string;
  actorRole?: AuditLogActorRole;
  action: string;
  targetType: string;
  targetId: string;
  details?: string;
  metadata?: Record<string, unknown>;
};

/**
 * In-mutation helper. Insert a single audit row.
 *
 * Call from any Convex mutation / query that already has a `ctx` and
 * knows the actor + action + target. Throws nothing on its own — if
 * `ctx.db.insert` throws, the surrounding mutation fails and Convex
 * surfaces the error in the deploy logs.
 *
 * The `_creationTime` Convex system field is the sort key for the
 * admin read query; an explicit `timestamp` field is also stored so
 * future migrations can rewrite rows without losing the action's
 * semantic timestamp.
 */
export async function writeAuditLog(
  ctx: MutationCtx,
  args: AuditLogWriteArgs
): Promise<Id<"auditLogs">> {
  return await ctx.db.insert("auditLogs", {
    actorId: args.actorId,
    actorRole: args.actorRole,
    action: args.action,
    targetType: args.targetType,
    targetId: args.targetId,
    details: args.details,
    metadata: args.metadata,
    timestamp: Date.now(),
  });
}

/**
 * Cross-call internal mutation. Equivalent to `writeAuditLog` but
 * invokable via `ctx.runMutation(internal.auditLog.recordAuditLog, ...)`
 * from outside the surrounding mutation (e.g., a Convex HTTP endpoint
 * or an Inngest worker after the shared-secret PR lands).
 *
 * Same shape as `writeAuditLog` so callers don't need to translate.
 */
export const recordAuditLog = internalMutation({
  args: {
    actorId: v.string(),
    actorRole: v.optional(v.union(
      v.literal("admin"),
      v.literal("support"),
      v.literal("instructor"),
      v.literal("student"),
      v.literal("system"),
    )),
    action: v.string(),
    targetType: v.string(),
    targetId: v.string(),
    details: v.optional(v.string()),
    metadata: v.optional(v.record(v.string(), v.any())),
  },
  handler: async (ctx, args): Promise<Id<"auditLogs">> => {
    return await writeAuditLog(ctx, args);
  },
});

/**
 * Admin-facing paginated read of audit logs.
 *
 * Filters (all optional, exact match). The query is single-filter:
 * exactly zero or one of the listed filters must be set, plus the
 * compound `targetType + targetId` pair (which counts as one filter).
 * Combining multiple non-compound filters is rejected so callers
 * don't silently get partial results.
 *
 *   - `actorId`   — who did it
 *   - `actorRole` — admin / support / instructor / student / system
 *   - `action`    — action name (e.g. "admin_onboard_student")
 *   - `targetType` + `targetId` — exact-lookup pair, paginated by
 *                    `timestamp` desc via the 3-column compound index
 *
 * Ordering:
 *   - Newest-first. The single-field indexes paginate in `_creationTime`
 *     desc; the compound `by_targetType_targetId_timestamp` index
 *     paginates in `timestamp` desc within the (targetType, targetId)
 *     pair.
 *
 * Limits:
 *   - `numItems` capped at 200 to stay within transaction read limits.
 *   - Default 50.
 */
export const listAuditLogs = query({
  args: {
    paginationOpts: v.any(),
    actorId: v.optional(v.string()),
    actorRole: v.optional(v.union(
      v.literal("admin"),
      v.literal("support"),
      v.literal("instructor"),
      v.literal("student"),
      v.literal("system"),
    )),
    action: v.optional(v.string()),
    targetType: v.optional(v.string()),
    targetId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { page: [], continueCursor: null, isDone: true };
    }
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    if (!user || (user.role !== "admin" && user.role !== "support")) {
      throw new Error("Admin or support role required");
    }

    // Reject combinations that would silently drop filters. The
    // `targetType + targetId` pair counts as a single filter.
    const hasActorId = args.actorId !== undefined;
    const hasActorRole = args.actorRole !== undefined;
    const hasAction = args.action !== undefined;
    const hasTargetType = args.targetType !== undefined;
    const hasTargetId = args.targetId !== undefined;
    const filterCount =
      Number(hasActorId) +
      Number(hasActorRole) +
      Number(hasAction) +
      (hasTargetType || hasTargetId ? 1 : 0);
    if (filterCount > 1) {
      throw new Error(
        "listAuditLogs supports a single filter per query (targetType+targetId is one filter). Split into multiple queries."
      );
    }
    if (hasTargetId && !hasTargetType) {
      throw new Error("listAuditLogs: targetId requires targetType");
    }

    const numItems = Math.min(
      (args.paginationOpts as { numItems?: number }).numItems ?? 50,
      200
    );
    const cursor = (args.paginationOpts as { cursor?: string | null }).cursor ?? null;
    const paginationOpts = { numItems, cursor };

    if (hasActorId) {
      return await ctx.db
        .query("auditLogs")
        .withIndex("by_actorId", (q) => q.eq("actorId", args.actorId!))
        .order("desc")
        .paginate(paginationOpts);
    }
    if (hasTargetType && hasTargetId) {
      return await ctx.db
        .query("auditLogs")
        .withIndex("by_targetType_targetId_timestamp", (q) =>
          q.eq("targetType", args.targetType!).eq("targetId", args.targetId!)
        )
        .order("desc")
        .paginate(paginationOpts);
    }
    if (hasTargetType) {
      return await ctx.db
        .query("auditLogs")
        .withIndex("by_targetType", (q) => q.eq("targetType", args.targetType!))
        .order("desc")
        .paginate(paginationOpts);
    }
    if (hasAction) {
      return await ctx.db
        .query("auditLogs")
        .withIndex("by_action", (q) => q.eq("action", args.action!))
        .order("desc")
        .paginate(paginationOpts);
    }
    if (hasActorRole) {
      return await ctx.db
        .query("auditLogs")
        .withIndex("by_actorRole", (q) => q.eq("actorRole", args.actorRole!))
        .order("desc")
        .paginate(paginationOpts);
    }
    return await ctx.db
      .query("auditLogs")
      .withIndex("by_timestamp", (q) => q.gt("timestamp", 0))
      .order("desc")
      .paginate(paginationOpts);
  },
});
