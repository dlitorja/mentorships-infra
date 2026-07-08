import { query } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

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
 * Public `query` rather than `internalQuery` so `npx convex run --prod`
 * can invoke it without admin-key ceremony. The data returned is
 * already reachable through `getSessionByVideoRoomName`
 * (`convex/sessions.ts:1381`) which is also public. The audit exposes
 * no new surface area.
 *
 * Exempts the "use bounded collections" guideline
 * (`convex/_generated/ai/guidelines.md:245`) because the purpose is
 * an exhaustive drift audit. Production session counts are bounded by
 * the underlying customer base and stay well within Convex transaction
 * limits. If session counts grow large enough that `.collect()` exceeds
 * 8192 docs, replace with a paginated audit scheduled via crons.
 */
export const auditVideoRoomNames = query({
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
