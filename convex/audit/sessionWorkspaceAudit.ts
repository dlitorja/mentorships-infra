import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { resolveSessionWorkspace } from "../lib/sessionWorkspace";

const auditPageValidator = v.object({
  scanned: v.number(),
  unresolvedSessionIds: v.array(v.id("sessions")),
  invalidWorkspaceSessionIds: v.array(v.id("sessions")),
  missingRecordingFlagSessionIds: v.array(v.id("sessions")),
  continueCursor: v.string(),
  isDone: v.boolean(),
});

export const auditSessionWorkspacePage = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: auditPageValidator,
  handler: async (ctx, args) => {
    const page = await ctx.db.query("sessions").paginate(args.paginationOpts);
    const unresolvedSessionIds: Id<"sessions">[] = [];
    const invalidWorkspaceSessionIds: Id<"sessions">[] = [];
    const missingRecordingFlagSessionIds: Id<"sessions">[] = [];

    for (const session of page.page) {
      const resolved = await resolveSessionWorkspace(ctx, session);
      if (session.workspaceId === undefined && !resolved) {
        unresolvedSessionIds.push(session._id);
      } else if (session.workspaceId !== undefined && !resolved) {
        invalidWorkspaceSessionIds.push(session._id);
      }
      if (
        session.hasRecordingArtifact === undefined &&
        (session.recordingUrl !== undefined ||
          session.recordingTransferStatus !== undefined)
      ) {
        missingRecordingFlagSessionIds.push(session._id);
      }
    }

    return {
      scanned: page.page.length,
      unresolvedSessionIds,
      invalidWorkspaceSessionIds,
      missingRecordingFlagSessionIds,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

const auditResultValidator = v.object({
  scanned: v.number(),
  unresolvedCount: v.number(),
  invalidWorkspaceCount: v.number(),
  missingRecordingFlagCount: v.number(),
  unresolvedSample: v.array(v.id("sessions")),
  invalidWorkspaceSample: v.array(v.id("sessions")),
  missingRecordingFlagSample: v.array(v.id("sessions")),
  truncated: v.boolean(),
});

type AuditPage = {
  scanned: number;
  unresolvedSessionIds: Id<"sessions">[];
  invalidWorkspaceSessionIds: Id<"sessions">[];
  missingRecordingFlagSessionIds: Id<"sessions">[];
  continueCursor: string;
  isDone: boolean;
};

export const auditSessionWorkspaceLinks = internalAction({
  args: {},
  returns: auditResultValidator,
  handler: async (ctx) => {
    let cursor: string | null = null;
    let scanned = 0;
    let unresolvedCount = 0;
    let invalidWorkspaceCount = 0;
    let missingRecordingFlagCount = 0;
    const unresolvedSample: Id<"sessions">[] = [];
    const invalidWorkspaceSample: Id<"sessions">[] = [];
    const missingRecordingFlagSample: Id<"sessions">[] = [];
    let isDone = false;

    for (let iteration = 0; iteration < 100 && !isDone; iteration++) {
      const page: AuditPage = await ctx.runQuery(
        internal.audit.sessionWorkspaceAudit.auditSessionWorkspacePage,
        { paginationOpts: { cursor, numItems: 100 } }
      );
      scanned += page.scanned;
      unresolvedCount += page.unresolvedSessionIds.length;
      invalidWorkspaceCount += page.invalidWorkspaceSessionIds.length;
      missingRecordingFlagCount += page.missingRecordingFlagSessionIds.length;
      unresolvedSample.push(...page.unresolvedSessionIds.slice(0, 20 - unresolvedSample.length));
      invalidWorkspaceSample.push(...page.invalidWorkspaceSessionIds.slice(0, 20 - invalidWorkspaceSample.length));
      missingRecordingFlagSample.push(
        ...page.missingRecordingFlagSessionIds.slice(
          0,
          20 - missingRecordingFlagSample.length
        )
      );
      cursor = page.continueCursor;
      isDone = page.isDone;
    }

    return {
      scanned,
      unresolvedCount,
      invalidWorkspaceCount,
      missingRecordingFlagCount,
      unresolvedSample,
      invalidWorkspaceSample,
      missingRecordingFlagSample,
      truncated: !isDone,
    };
  },
});
