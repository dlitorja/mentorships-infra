import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const store = mutation({
  args: {
    body: v.bytes(),
    contentType: v.string(),
  },
  handler: async (ctx, args) => {
    const storageId = await ctx.storage.store(args.body, args.contentType);
    return storageId;
  },
});

export const deleteFile = mutation({
  args: { storageId: v.string() },
  handler: async (ctx, args) => {
    await ctx.storage.delete(args.storageId as any);
    return { success: true };
  },
});