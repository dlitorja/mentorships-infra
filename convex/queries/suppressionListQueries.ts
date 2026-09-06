import { internalQuery } from "../_generated/server";
import { v } from "convex/values";

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
      .collect();
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
