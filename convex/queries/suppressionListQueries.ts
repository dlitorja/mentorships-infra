import { internalQuery } from "../_generated/server";
import { v } from "convex/values";

const LIST_ROW_SCAN_CAP = 5000;

export const getListStateRowsBefore = internalQuery({
  args: {
    before: v.number(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("suppressionEvents")
      .withIndex("by_resendId_and_kind", (q) =>
        q.gte("resendId", "list:").lt("resendId", "list;")
      )
      .take(LIST_ROW_SCAN_CAP);
    return rows
      .filter((r) => r.receivedAt < args.before)
      .map((r) => ({
        resendId: r.resendId,
        email: r.email,
        domain: r.domain,
        kind: r.kind,
        receivedAt: r.receivedAt,
      }));
  },
});
