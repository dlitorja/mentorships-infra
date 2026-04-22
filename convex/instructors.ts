import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

export const getInstructorById = query({
  args: { id: v.id("instructors") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }
    return await ctx.db.get(args.id);
  },
});

export const getInstructorBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("instructors")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
  },
});

// Public query - no auth required
export const getPublicInstructorBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const instructor = await ctx.db
      .query("instructors")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();

    if (!instructor || !instructor.isActive) {
      return null;
    }

    // Get mentor data (inventory) if linked - only expose safe public fields
    let mentor = null;
    if (instructor.mentorId) {
      const fullMentor = await ctx.db.get(instructor.mentorId as Id<"mentors">);
      if (fullMentor) {
        mentor = {
          _id: fullMentor._id,
          oneOnOneInventory: fullMentor.oneOnOneInventory,
          groupInventory: fullMentor.groupInventory,
          maxActiveStudents: fullMentor.maxActiveStudents,
        };
      }
    }

    // Get testimonials
    const testimonials = await ctx.db
      .query("instructorTestimonials")
      .withIndex("by_instructorId", (q) => q.eq("instructorId", instructor._id))
      .collect();

    // Get mentee results
    const menteeResults = await ctx.db
      .query("menteeResults")
      .withIndex("by_instructorId", (q) => q.eq("instructorId", instructor._id))
      .collect();

    return {
      instructor,
      mentor,
      testimonials,
      menteeResults,
    };
  },
});

// Public query - no auth required
export const getPublicInstructors = query({
  handler: async (ctx) => {
    const instructors = await ctx.db
      .query("instructors")
      .withIndex("by_isActive", (q) => q.eq("isActive", true))
      .collect();

    // Get mentor data for each instructor - only expose safe public fields
    const instructorsWithMentors = await Promise.all(
      instructors.map(async (instructor) => {
        let mentor = null;
        if (instructor.mentorId) {
          const fullMentor = await ctx.db.get(instructor.mentorId as Id<"mentors">);
          if (fullMentor) {
            mentor = {
              _id: fullMentor._id,
              oneOnOneInventory: fullMentor.oneOnOneInventory,
              groupInventory: fullMentor.groupInventory,
              maxActiveStudents: fullMentor.maxActiveStudents,
            };
          }
        }
        return {
          ...instructor,
          mentor,
        };
      })
    );

    return instructorsWithMentors;
  },
});

export const getInstructorByMentorId = query({
  args: { mentorId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }
    return await ctx.db
      .query("instructors")
      .withIndex("by_mentorId", (q) => q.eq("mentorId", args.mentorId))
      .first();
  },
});

export const listInstructors = query({
  handler: async (ctx) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    return await ctx.db.query("instructors").collect();
  },
});

export const listActiveInstructors = query({
  handler: async (ctx) => {
    return await ctx.db
      .query("instructors")
      .withIndex("by_isActive", (q) => q.eq("isActive", true))
      .collect();
  },
});

export const createInstructor = mutation({
  args: {
    userId: v.optional(v.string()),
    mentorId: v.optional(v.string()),
    email: v.optional(v.string()),
    name: v.string(),
    slug: v.string(),
    tagline: v.optional(v.string()),
    bio: v.optional(v.string()),
    specialties: v.optional(v.array(v.string())),
    background: v.optional(v.array(v.string())),
    profileImageUrl: v.optional(v.string()),
    profileImageUploadPath: v.optional(v.string()),
    portfolioImages: v.optional(v.array(v.string())),
    socials: v.optional(v.any()),
    isActive: v.optional(v.boolean()),
    isNew: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("instructors")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    
    if (existing) {
      throw new Error("Instructor with this slug already exists");
    }
    
    return await ctx.db.insert("instructors", {
      ...args,
      isActive: args.isActive ?? true,
    });
  },
});

export const updateInstructor = mutation({
  args: {
    id: v.id("instructors"),
    userId: v.optional(v.string()),
    mentorId: v.optional(v.string()),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    slug: v.optional(v.string()),
    tagline: v.optional(v.string()),
    bio: v.optional(v.string()),
    specialties: v.optional(v.array(v.string())),
    background: v.optional(v.array(v.string())),
    profileImageUrl: v.optional(v.string()),
    profileImageUploadPath: v.optional(v.string()),
    portfolioImages: v.optional(v.array(v.string())),
    socials: v.optional(v.any()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    await ctx.db.patch(id, updates);
    return await ctx.db.get(id);
  },
});

export const deleteInstructor = mutation({
  args: { id: v.id("instructors") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

export const deactivateInstructor = mutation({
  args: { id: v.id("instructors") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { isActive: false });
    return await ctx.db.get(args.id);
  },
});

export const activateInstructor = mutation({
  args: { id: v.id("instructors") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { isActive: true });
    return await ctx.db.get(args.id);
  },
});

export const getTestimonials = query({
  args: { instructorId: v.id("instructors") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("instructorTestimonials")
      .withIndex("by_instructorId", (q) => q.eq("instructorId", args.instructorId))
      .collect();
  },
});

export const createTestimonial = mutation({
  args: {
    instructorId: v.id("instructors"),
    name: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("instructorTestimonials", args);
  },
});

export const deleteTestimonial = mutation({
  args: { id: v.id("instructorTestimonials") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

export const getMenteeResults = query({
  args: { instructorId: v.id("instructors") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("menteeResults")
      .withIndex("by_instructorId", (q) => q.eq("instructorId", args.instructorId))
      .collect();
  },
});

export const createMenteeResult = mutation({
  args: {
    instructorId: v.id("instructors"),
    imageUrl: v.optional(v.string()),
    imageUploadPath: v.optional(v.string()),
    studentName: v.optional(v.string()),
    createdBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("menteeResults", args);
  },
});

export const deleteMenteeResult = mutation({
  args: { id: v.id("menteeResults") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});
