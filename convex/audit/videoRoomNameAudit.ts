import { internalAction, internalQuery } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";

type DuplicateGroup = {
  videoRoomName: string;
  sessionIds: Id<"sessions">[];
  createdAt: number[];
  statuses: string[];
};

type AuditResult = {
  totalSessions: number;
  sessionsWithVideoRoomName: number;
  distinctVideoRoomNames: number;
  duplicates: DuplicateGroup[];
  generatedAt: number;
};

/**
 * PR #7 MIGRATE-phase audit: verify production state of `videoRoomName`
 * uniqueness across the `sessions` table.
 *
 * PR #611 added a widen-phase uniqueness guard inside `setVideoRoom`
 * (see `convex/sessions.ts:1278-1296`) that throws on conflict. This
 * query inspects existing data for drift that predates the guard so the
 * MIGRATE phase can decide whether to remove the legacy `.collect()` +
 * `if (matches.length > 1) throw` guards at
 * `convex/sessions.ts:1146-1151` and `1368-1372`, and whether to
 * pursue NARROW-phase `.unique()` schema enforcement.
 *
 * `internalQuery` (not `query`) so it is NOT publicly callable. The
 * session inventory it returns is sensitive and would otherwise be
 * reachable by any unauthenticated client. Verified: unauthenticated
 * HTTP POST to `${CONVEX_DEPLOYMENT_URL}/api/query` returns
 * "Server Error". Invocation paths for the audit:
 *
 *  - CLI (uses the deploy key from `deploy-prod.env`):
 *      `npx convex run --prod 'audit/videoRoomNameAudit:auditVideoRoomNames' '{}'`
 *    The `internal.` prefix is also accepted as the explicit form.
 *  - Convex dashboard console: deploy `fine-bulldog-260`, navigate to
 *    Functions → `audit/videoRoomNameAudit:auditVideoRoomNames` → Run.
 *  - Admin HTTP API: POST to `${CONVEX_DEPLOYMENT_URL}/api/query` with
 *    path `audit/videoRoomNameAudit:auditVideoRoomNames` and
 *    `Authorization: Convex ${CONVEX_HTTP_KEY}`.
 *  - Wrapper action / cron: invoke via `ctx.runQuery(internal.audit.
 *    videoRoomNameAudit.auditVideoRoomNames, {})` from a server-side
 *    function that already has the deployment's auth context. The
 *    `auditVideoRoomNameDriftMonitor` action below is the production
 *    cron wrapper, scheduled every 6h in `convex/crons.ts` and surfaced
 *    via the dashboard log if any duplicate group appears.
 *
 * Exempts the "use bounded collections" guideline
 * (`convex/_generated/ai/guidelines.md:245`) because the purpose is
 * an exhaustive drift audit. Production session counts are bounded by
 * the underlying customer base and stay well within Convex transaction
 * limits. If session counts grow large enough that `.collect()` exceeds
 * 8192 docs, replace with a paginated audit scheduled via crons.
 */
export const auditVideoRoomNames = internalQuery({
  args: {},
  handler: async (ctx): Promise<AuditResult> => {
    const all = await ctx.db.query("sessions").collect();

    const byName = new Map<string, Doc<"sessions">[]>();
    for (const session of all) {
      if (session.videoRoomName !== undefined) {
        const list = byName.get(session.videoRoomName) ?? [];
        list.push(session);
        byName.set(session.videoRoomName, list);
      }
    }

    const duplicates: DuplicateGroup[] = [];
    for (const [name, list] of byName) {
      if (list.length > 1) {
        duplicates.push({
          videoRoomName: name,
          sessionIds: list.map((s) => s._id),
          createdAt: list.map((s) => s._creationTime).sort((a, b) => a - b),
          statuses: list.map((s) => String(s.status)),
        });
      }
    }
    duplicates.sort((a, b) => b.sessionIds.length - a.sessionIds.length);

    return {
      totalSessions: all.length,
      sessionsWithVideoRoomName: Array.from(byName.values()).reduce(
        (n, l) => n + l.length,
        0
      ),
      distinctVideoRoomNames: byName.size,
      duplicates,
      generatedAt: Date.now(),
    };
  },
});

/**
 * Scheduled drift monitor for `videoRoomName` uniqueness.
 *
 * Runs every 6 hours via `crons.interval` in `convex/crons.ts`. Wraps
 * the `auditVideoRoomNames` internalQuery and surfaces any duplicate
 * groups to the Convex dashboard log so drift does not silently
 * accumulate between manual audit runs.
 *
 * `internalAction` (not `action`) so it is not publicly callable. The
 * only legitimate trigger is the cron; an out-of-band caller has no
 * reason to invoke it and would only see the same drift summary the
 * dashboard log already captures.
 *
 * Alerting is intentionally minimal: `console.error` with the full
 * duplicate groups so the failure mode is visible in the Convex
 * dashboard Logs tab (and forwarded to Axiom via the project's
 * existing Convex log export). No new schema, no email, no Slack —
 * matches the MIGRATE-phase recovery path documented in the audit
 * query's JSDoc and at `convex/sessions.ts:1146-1164` /
 * `1401-1426`: re-run the audit CLI, identify the duplicate, manually
 * patch the wrong row, then resolve the conflict at the write site.
 *
 * Returns a small summary so the cron run log has a structured record
 * even when no drift is detected.
 */
export const auditVideoRoomNameDriftMonitor = internalAction({
  args: {},
  handler: async (ctx): Promise<DriftMonitorResult> => {
    const result = await ctx.runQuery(
      internal.audit.videoRoomNameAudit.auditVideoRoomNames,
      {}
    );
    const ranAt = Date.now();

    if (result.duplicates.length > 0) {
      console.error(
        `[videoRoomName drift] ${result.duplicates.length} duplicate group(s) across ${result.totalSessions} sessions (${result.sessionsWithVideoRoomName} with videoRoomName). Re-run 'npx convex run --prod audit/videoRoomNameAudit:auditVideoRoomNames {}' for details.`,
        result.duplicates
      );
    }

    return {
      duplicatesCount: result.duplicates.length,
      totalSessions: result.totalSessions,
      ranAt,
    };
  },
});

type DriftMonitorResult = {
  duplicatesCount: number;
  totalSessions: number;
  ranAt: number;
};
