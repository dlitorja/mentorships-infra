import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    email: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    role: v.optional(v.union(v.literal("student"), v.literal("mentor"), v.literal("admin"), v.literal("video_editor"))),
    timeZone: v.optional(v.string()),
  }).index("by_email", ["email"]),
});
