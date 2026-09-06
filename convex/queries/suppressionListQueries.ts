import { internalQuery } from "../_generated/server";
import { v } from "convex/values";

const PAGE_SIZE = 1000;

export const getListStateRowsBefore = internalQuery({
  args: {
    before: v.number(),
  },
  handler: async (ctx, args) => {
    const out: Array<{
      resendId: string;
      email: string;
      domain: string;
      kind: "bounce" | "complaint" | "unsubscribe" | "removed";
      receivedAt: number;
    }> = [];

    let cursor: string | null = null;
    let isDone = false;
    let pages = 0;
    while (!isDone && pages < 20) {
      const result = await ctx.db
        .query("suppressionEvents")
        .withIndex("by_resendId_and_kind", (q) =>
          q.gte("resendId", "list:").lt("resendId", "list;")
        )
        .paginate({ cursor, numItems: PAGE_SIZE });
      pages++;

      for (const r of result.page) {
        if (r.receivedAt < args.before) {
          out.push({
            resendId: r.resendId,
            email: r.email,
            domain: r.domain,
            kind: r.kind,
            receivedAt: r.receivedAt,
          });
        }
      }

      isDone = result.isDone;
      cursor = result.isDone ? null : result.continueCursor;
    }

    return out;
  },
});
