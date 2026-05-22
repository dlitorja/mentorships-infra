'use node';

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
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
  handler: async (ctx, args): Promise<any> => {
    const { userId, role, ts, sig } = args;
    const secret = process.env.CONVEX_SERVER_SHARED_SECRET;
    if (!secret) throw new Error("Server misconfigured: CONVEX_SERVER_SHARED_SECRET not set");

    const now = Date.now();
    if (Math.abs(now - ts) > 5 * 60 * 1000) {
      throw new Error("Signature expired");
    }

    const msg = `${userId}:${role}:${ts}`;
    const expectedHex = crypto.createHmac("sha256", secret).update(msg).digest("hex");
    const expectedBuf = Buffer.from(expectedHex, "hex");
    const sigBuf = Buffer.from(sig, "hex");
    // Avoid RangeError from mismatched lengths
    if (expectedBuf.length !== sigBuf.length) {
      throw new Error("Invalid signature");
    }
    if (!crypto.timingSafeEqual(expectedBuf, sigBuf)) {
      throw new Error("Invalid signature");
    }

    // Delegate to internal trusted mutation
    const updated: any = await ctx.runMutation(internal.users.setUserRoleTrusted as any, {
      userId,
      role,
    });
    return updated;
  },
});
