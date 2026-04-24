import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import {
  getWorkspacesNeedingDeletion,
  getWorkspacesForNotification,
  getUserEmail,
  getWorkspaceExportData,
} from "./queries/http";
import {
  deleteAllWorkspaceContent,
  createRetentionNotification,
  updateWorkspaceExportStatus,
} from "./mutations/http";
import { decrementInventory, incrementInventory, updateInstructor } from "./instructors";
import { markNotifiedByInstructor } from "./waitlist";

const CONVEX_HTTP_KEY = process.env.CONVEX_HTTP_KEY;

function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

function verifyAuth(request: Request): boolean {
  // Only skip auth for seed endpoint in development
  if (request.url.includes("/seed/")) {
    const allowDevSeed = process.env.ALLOW_DEV_SEED === "true" && process.env.NODE_ENV !== "production";
    if (!allowDevSeed) {
      console.warn("Seed endpoint access denied - set ALLOW_DEV_SEED=true in dev only");
      return false;
    }
    return true;
  }
  
  // Skip auth in development mode if no key is configured
  if (!CONVEX_HTTP_KEY && process.env.NODE_ENV !== "production") {
    return true;
  }
  
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) return false;
  const expected = `Bearer ${CONVEX_HTTP_KEY}`;
  return authHeader === expected;
}

/** Returns workspaces past the 18-month retention period that are pending deletion. */
export const httpGetWorkspacesNeedingDeletion = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  const workspaces = await ctx.runQuery(getWorkspacesNeedingDeletion as any);

  return new Response(JSON.stringify({ workspaces }), {
    headers: { "Content-Type": "application/json" },
  });
});

/** Returns workspaces approaching deletion that are due for a retention notification. */
export const httpGetWorkspacesForNotification = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  const notifications = await ctx.runQuery(getWorkspacesForNotification as any);

  return new Response(JSON.stringify({ notifications }), {
    headers: { "Content-Type": "application/json" },
  });
});

/** Deletes all notes, links, images, and messages associated with a workspace. */
export const httpDeleteAllWorkspaceContent = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  const { workspaceId } = await request.json();

  const result = await ctx.runMutation(deleteAllWorkspaceContent as any, { workspaceId: workspaceId as any });

  return new Response(JSON.stringify({ deleted: result.deleted }), {
    headers: { "Content-Type": "application/json" },
  });
});

/** Creates a retention notification record for a workspace user. */
export const httpCreateRetentionNotification = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  const { workspaceId, userId, notificationType } = await request.json();

  const result = await ctx.runMutation(createRetentionNotification as any, {
    workspaceId: workspaceId as any,
    userId,
    notificationType,
  });

  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
  });
});

/** Retrieves a user's email address by their Clerk ID. */
export const httpGetUserEmail = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  const { clerkId } = await request.json();

  const result = await ctx.runQuery(getUserEmail as any, { clerkId });

  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
  });
});

/** Fetches a workspace's notes and images for data export. */
export const httpGetWorkspaceExportData = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  const { workspaceId } = await request.json();

  try {
    const result = await ctx.runQuery(getWorkspaceExportData as any, { workspaceId: workspaceId as any });
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = (error as Error).message;
    const status = message.includes("not found") ? 404 : 500;
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
});

/** Updates a workspace export record's status, download URL, and expiration. */
export const httpUpdateWorkspaceExportStatus = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  const { exportId, status, downloadUrl, expiresAt } = await request.json();

  try {
    const result = await ctx.runMutation(updateWorkspaceExportStatus as any, {
      exportId: exportId as any,
      status,
      downloadUrl,
      expiresAt,
    });
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = (error as Error).message;
    const status = message.includes("not found") ? 404 : 500;
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
});

const typeMap: Record<string, "oneOnOne" | "group"> = {
  "one-on-one": "oneOnOne",
  "oneOnOne": "oneOnOne",
  group: "group",
};

/** Decrements an instructor's mentorship inventory slot for a given type. */
export const httpDecrementInventory = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  const { mentorId, type } = await request.json();

  const normalizedType = typeMap[type] || type;
  const mentorIdTyped = mentorId as any;

  try {
    const result = await ctx.runMutation(decrementInventory as any, {
      id: mentorIdTyped,
      type: normalizedType,
    });
    return new Response(JSON.stringify({ success: true, inventory: result }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = (error as Error).message;
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
});

/** Increments an instructor's mentorship inventory by a given quantity and type. */
export const httpIncrementInventory = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  const { mentorId, type, quantity } = await request.json();

  const normalizedType = typeMap[type] || type;
  const mentorIdTyped = mentorId as any;
  const qty = quantity || 1;

  try {
    let result;
    for (let i = 0; i < qty; i++) {
      result = await ctx.runMutation(incrementInventory as any, {
        id: mentorIdTyped,
        type: normalizedType,
      });
    }
    return new Response(JSON.stringify({ success: true, inventory: result }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = (error as Error).message;
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
});

/** Sets an instructor's one-on-one and/or group inventory to specific values. */
export const httpSetInventory = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  const { mentorId, oneOnOneInventory, groupInventory } = await request.json();
  const mentorIdTyped = mentorId as any;

  try {
    const updates: Record<string, any> = {};
    if (oneOnOneInventory !== undefined) {
      updates.oneOnOneInventory = oneOnOneInventory;
    }
    if (groupInventory !== undefined) {
      updates.groupInventory = groupInventory;
    }

    const result = await ctx.runMutation(updateInstructor as any, {
      id: mentorIdTyped,
      ...updates,
    });
    return new Response(JSON.stringify({ success: true, inventory: result }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = (error as Error).message;
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
});

/** Marks waitlist entries as notified when an instructor has availability. */
export const httpNotifyWaitlist = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  const { instructorSlug, mentorshipType } = await request.json();

  const normalizedType = mentorshipType ? typeMap[mentorshipType] || mentorshipType : undefined;

  try {
    const result = await ctx.runMutation(markNotifiedByInstructor as any, {
      instructorSlug,
      mentorshipType: normalizedType,
    });
    return new Response(JSON.stringify({ success: true, notifiedCount: result.count }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = (error as Error).message;
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
});

const http = httpRouter();

http.route({
  path: "/workspace/retention/delete",
  method: "POST",
  handler: httpDeleteAllWorkspaceContent,
});

http.route({
  path: "/workspace/retention/needing-deletion",
  method: "GET",
  handler: httpGetWorkspacesNeedingDeletion,
});

http.route({
  path: "/workspace/retention/for-notification",
  method: "GET",
  handler: httpGetWorkspacesForNotification,
});

http.route({
  path: "/workspace/retention/notify",
  method: "POST",
  handler: httpCreateRetentionNotification,
});

http.route({
  path: "/users/email",
  method: "POST",
  handler: httpGetUserEmail,
});

http.route({
  path: "/workspace/export/data",
  method: "POST",
  handler: httpGetWorkspaceExportData,
});

http.route({
  path: "/workspace/export/update-status",
  method: "POST",
  handler: httpUpdateWorkspaceExportStatus,
});

http.route({
  path: "/inventory/decrement",
  method: "POST",
  handler: httpDecrementInventory,
});

http.route({
  path: "/inventory/increment",
  method: "POST",
  handler: httpIncrementInventory,
});

http.route({
  path: "/inventory/set",
  method: "POST",
  handler: httpSetInventory,
});

http.route({
  path: "/waitlist/notify",
  method: "POST",
  handler: httpNotifyWaitlist,
});

const httpSeedInstructor = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  const { 
    name, 
    slug, 
    tagline, 
    bio, 
    specialties, 
    background, 
    profileImageUrl, 
    portfolioImages, 
    socials, 
    pricing,
    testimonials,
    menteeBeforeAfterImages,
    isNew
  } = await request.json();

  // Check if instructor already exists using runQuery
  const existingInstructor = await ctx.runQuery(api.instructors.getInstructorBySlug, { slug });

  if (existingInstructor) {
    return new Response(JSON.stringify({ 
      success: true, 
      skipped: true, 
      message: "Instructor already exists",
      instructorId: existingInstructor._id
    }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const oneOnOneInventory = 3;
  const groupInventory = pricing?.group ? 2 : 0;

  // Create instructor using runMutation
  const mentorId = await ctx.runMutation(api.instructors.createInstructor, {
    userId: `seed-${slug}`,
    oneOnOneInventory,
    groupInventory,
    maxActiveStudents: 10,
  });

  // Create instructor using runMutation
  const instructorId = await ctx.runMutation(api.instructors.createInstructor as any, {
    name,
    slug,
    tagline,
    bio,
    specialties,
    background,
    profileImageUrl,
    portfolioImages,
    socials,
    isActive: true,
    isNew: isNew || false,
    mentorId,
  });

  if (pricing?.oneOnOne) {
    await ctx.runMutation(api.products.createProduct as any, {
      mentorId,
      title: "1-on-1 Mentorship",
      description: `4-session mentorship with ${name}`,
      price: pricing.oneOnOne.toString(),
      sessionsPerPack: 4,
      validityDays: 60,
      mentorshipType: "one-on-one",
      active: true,
    });
  }

  if (pricing?.group) {
    await ctx.runMutation(api.products.createProduct as any, {
      mentorId,
      title: "Group Mentorship",
      description: `4-session group mentorship with ${name}`,
      price: pricing.group.toString(),
      sessionsPerPack: 4,
      validityDays: 60,
      mentorshipType: "group",
      active: true,
    });
  }

  if (testimonials && testimonials.length > 0) {
    for (const testimonial of testimonials) {
      await ctx.runMutation(api.instructors.createTestimonial as any, {
        instructorId,
        name: testimonial.author,
        text: testimonial.text,
      });
    }
  }

  if (menteeBeforeAfterImages && menteeBeforeAfterImages.length > 0) {
    for (const imageUrl of menteeBeforeAfterImages) {
      await ctx.runMutation(api.instructors.createMenteeResult as any, {
        instructorId,
        imageUrl,
      });
    }
  }

  return new Response(JSON.stringify({ 
    success: true, 
    skipped: false,
    message: "Instructor seeded successfully",
    instructorId,
    mentorId,
    oneOnOneInventory,
    groupInventory,
  }), {
    headers: { "Content-Type": "application/json" },
  });
});

http.route({
  path: "/seed/instructor",
  method: "POST",
  handler: httpSeedInstructor,
});

export default http;
