import { internalQuery } from "../_generated/server";

export const getActiveSuppressionRows = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("suppressionEvents")
      .withIndex("by_resendId_and_kind", (q) =>
        q.gte("resendId", "suppress:").lt("resendId", "suppress;")
      )
      .collect();
    return rows
      .filter((r) => r.kind !== "removed")
      .map((r) => ({
        resendId: r.resendId,
        email: r.email,
        domain: r.domain,
        kind: r.kind,
      }));
  },
});
