import { internalQuery } from "../_generated/server";

export const getListStateRows = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("suppressionEvents")
      .withIndex("by_resendId_and_kind", (q) =>
        q.gte("resendId", "list:").lt("resendId", "list;")
      )
      .collect();
    return rows.map((r) => ({
      resendId: r.resendId,
      email: r.email,
      domain: r.domain,
      kind: r.kind,
    }));
  },
});
