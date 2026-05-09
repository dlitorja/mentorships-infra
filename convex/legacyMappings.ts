import { query } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

export const getUsersByLegacyId = query({
  args: { legacyId: v.string() },
  handler: async (ctx, args) => {
    const users = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", args.legacyId))
      .collect();
    return users.length > 0 ? users[0] : null;
  },
});

export const getInstructorsByLegacyId = query({
  args: { legacyId: v.string() },
  handler: async (ctx, args) => {
    const instructors = await ctx.db
      .query("instructors")
      .withIndex("by_userId", (q) => q.eq("userId", args.legacyId))
      .collect();
    return instructors.length > 0 ? instructors[0] : null;
  },
});

export const getInstructorsByMentorId = query({
  args: { mentorId: v.string() },
  handler: async (ctx, args) => {
    const instructors = await ctx.db
      .query("instructors")
      .filter((q) => q.eq(q.field("mentorId"), args.mentorId))
      .collect();
    return instructors.length > 0 ? instructors[0] : null;
  },
});

export const getOrdersByLegacyId = query({
  args: { legacyId: v.string() },
  handler: async (ctx, args) => {
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_userId", (q) => q.eq("userId", args.legacyId))
      .collect();
    return orders.length > 0 ? orders[0] : null;
  },
});

export const getPaymentsByLegacyId = query({
  args: { legacyId: v.string() },
  handler: async (ctx, args) => {
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_orderId", (q) => q.eq("orderId", args.legacyId as Id<"orders">))
      .collect();
    return payments.length > 0 ? payments[0] : null;
  },
});

export const getSessionPacksByLegacyId = query({
  args: { legacyId: v.string() },
  handler: async (ctx, args) => {
    const packs = await ctx.db
      .query("sessionPacks")
      .withIndex("by_userId", (q) => q.eq("userId", args.legacyId))
      .collect();
    return packs;
  },
});

export const getUsersByClerkId = query({
  args: { clerkId: v.string() },
  handler: async (ctx, args) => {
    const users = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", args.clerkId))
      .collect();
    return users.length > 0 ? users[0] : null;
  },
});

export const getAllUsersMappings = query({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    return users.map((u) => ({
      legacyId: u.legacyId ?? u.userId,
      clerkId: u.clerkId,
      convexId: u._id,
    }));
  },
});

export const getAllInstructorsMappings = query({
  args: {},
  handler: async (ctx) => {
    const instructors = await ctx.db.query("instructors").collect();
    return instructors.map((i) => ({
      legacyId: i.legacyId ?? i.mentorId,
      userId: i.userId,
      convexId: i._id,
    }));
  },
});

export const getAllOrdersMappings = query({
  args: {},
  handler: async (ctx) => {
    const orders = await ctx.db.query("orders").collect();
    return orders.map((o) => ({
      legacyId: o.legacyId ?? o._id,
      userId: o.userId,
      convexId: o._id,
    }));
  },
});

export const getAllPaymentsMappings = query({
  args: {},
  handler: async (ctx) => {
    const payments = await ctx.db.query("payments").collect();
    return payments.map((p) => ({
      legacyId: p.legacyId ?? p._id,
      orderId: p.orderId,
      convexId: p._id,
    }));
  },
});

export const getAllSessionPacksMappings = query({
  args: {},
  handler: async (ctx) => {
    const packs = await ctx.db.query("sessionPacks").collect();
    return packs.map((p) => ({
      legacyId: p.legacyId ?? p._id,
      userId: p.userId,
      mentorId: p.mentorId,
      paymentId: p.paymentId,
      convexId: p._id,
    }));
  },
});