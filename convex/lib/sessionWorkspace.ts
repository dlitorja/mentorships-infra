import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type DatabaseCtx = QueryCtx | MutationCtx;
type SessionWorkspaceFields = Pick<
  Doc<"sessions">,
  "workspaceId" | "sessionPackId" | "instructorId" | "studentId"
>;

function workspaceMatchesSession(
  workspace: Doc<"workspaces">,
  session: Pick<SessionWorkspaceFields, "instructorId" | "studentId">
): boolean {
  return (
    workspace.instructorId === session.instructorId &&
    workspace.ownerId === session.studentId &&
    (workspace.type === undefined || workspace.type === "mentorship")
  );
}

async function resolveWorkspaceThroughPack(
  ctx: DatabaseCtx,
  session: SessionWorkspaceFields
): Promise<Doc<"workspaces"> | null> {
  if (!session.sessionPackId) return null;

  const seats = await ctx.db
    .query("seatReservations")
    .withIndex("by_sessionPackId", (q) =>
      q.eq("sessionPackId", session.sessionPackId!)
    )
    .take(2);
  if (seats.length !== 1) return null;

  const workspaces = await ctx.db
    .query("workspaces")
    .withIndex("by_seatReservationId", (q) =>
      q.eq("seatReservationId", seats[0]._id)
    )
    .take(2);
  if (workspaces.length !== 1) return null;
  return workspaceMatchesSession(workspaces[0], session)
    ? workspaces[0]
    : null;
}

/** Resolves a session workspace only when stored data proves one result. */
export async function resolveSessionWorkspace(
  ctx: DatabaseCtx,
  session: SessionWorkspaceFields
): Promise<Doc<"workspaces"> | null> {
  if (session.workspaceId) {
    const workspace = await ctx.db.get(session.workspaceId);
    return workspace && workspaceMatchesSession(workspace, session)
      ? workspace
      : null;
  }

  const packWorkspace = await resolveWorkspaceThroughPack(ctx, session);
  if (packWorkspace) return packWorkspace;

  const pairWorkspaces = await ctx.db
    .query("workspaces")
    .withIndex("by_instructorId_ownerId", (q) =>
      q
        .eq("instructorId", session.instructorId)
        .eq("ownerId", session.studentId)
    )
    .take(2);
  if (pairWorkspaces.length !== 1) return null;
  return workspaceMatchesSession(pairWorkspaces[0], session)
    ? pairWorkspaces[0]
    : null;
}

/** Resolves the active workspace that owns a new pack-backed session. */
export async function resolveWorkspaceForNewSession(
  ctx: DatabaseCtx,
  args: {
    sessionPackId: Id<"sessionPacks">;
    instructorId: Id<"instructors">;
    studentId: string;
  }
): Promise<Doc<"workspaces"> | null> {
  const session = {
    ...args,
    workspaceId: undefined,
  };
  const workspace = await resolveWorkspaceThroughPack(ctx, session);
  if (
    workspace &&
    workspace.deletedAt === undefined &&
    workspace.endedAt === undefined
  ) {
    return workspace;
  }

  const findActivePairWorkspaces = (type: "mentorship" | undefined) =>
    ctx.db
      .query("workspaces")
      .withIndex(
        "by_instructorId_and_ownerId_and_type_and_endedAt_and_deletedAt",
        (q) =>
          q
            .eq("instructorId", args.instructorId)
            .eq("ownerId", args.studentId)
            .eq("type", type)
            .eq("endedAt", undefined)
            .eq("deletedAt", undefined)
      )
      .take(2);
  const activePairWorkspaces = (
    await Promise.all([
      findActivePairWorkspaces("mentorship"),
      findActivePairWorkspaces(undefined),
    ])
  ).flat();
  const activeWorkspace = activePairWorkspaces[0];
  if (
    activePairWorkspaces.length !== 1 ||
    !activeWorkspace ||
    activeWorkspace.deletedAt !== undefined ||
    activeWorkspace.endedAt !== undefined
  ) {
    return null;
  }
  return activeWorkspace;
}
