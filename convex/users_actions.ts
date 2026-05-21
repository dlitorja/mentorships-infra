'use node';

import { action, internal } from "./_generated/server";
import { v } from "convex/values";
import crypto from "node:crypto";

/**
 * Server-verified role elevation using HMAC.
 * Verifies HMAC using CONVEX_SERVER_SHARED_SECRET and delegates to
 * internal.users.setUserRoleTrusted.
 */
export const serverVerifiedSetUserRole = action({
  args: {
    userId: v.string(),
    role: v.union(v.literal("student"), v.literal("instructor"), v.literal("admin"), v.literal("video_editor")),
    ts: v.number(),
    sig: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId, role, ts, sig } = args;
    const secret = process.env.CONVEX_SERVER_SHARED_SECRET;
    if (!secret) throw new Error("Server misconfigured: CONVEX_SERVER_SHARED_SECRET not set");

    const now = Date.now();
    if (Math.abs(now - ts) > 5 * 60 * 1000) {
      throw new Error("Signature expired");
    }

    const msg = `${userId}:${role}:${ts}`;
    const expected = crypto.createHmac("sha256", secret).update(msg).digest("hex");
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) {
      throw new Error("Invalid signature");
    }

    // Delegate to internal trusted mutation
    const updated = await ctx.runMutation(internal.users.setUserRoleTrusted, {
      userId,
      role,
    });
    return updated;
  },
});
