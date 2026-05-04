import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

async function isAdminUser(ctx: QueryCtx, userId: string): Promise<boolean> {
  const user = await ctx.db
    .query("users")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
  return user?.role === "admin";
}

type MentorWithEmail = {
  id: Id<"instructors">;
  userId: string | null;
  email: string | null;
  maxActiveStudents: number | null;
  oneOnOneInventory: number | null;
  groupInventory: number | null;
  createdAt: number | null;
};

export const getAllMentors = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const isAdmin = await isAdminUser(ctx, identity.subject);
    if (!isAdmin) return [];

    const instructors = await ctx.db.query("instructors").collect();

    const results: MentorWithEmail[] = await Promise.all(
      instructors.map(async (instructor) => {
        let email: string | null = null;
        if (instructor.userId) {
          const user = await ctx.db
            .query("users")
            .withIndex("by_userId", (q) => q.eq("userId", instructor.userId))
            .first();
          email = user?.email ?? null;
        }
        return {
          id: instructor._id,
          userId: instructor.userId ?? null,
          email,
          maxActiveStudents: instructor.maxActiveStudents ?? null,
          oneOnOneInventory: instructor.oneOnOneInventory ?? null,
          groupInventory: instructor.groupInventory ?? null,
          createdAt: instructor._creationTime,
        };
      })
    );

    return results.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  },
});