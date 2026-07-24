import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import { internal } from "./_generated/api";
import {
  getWorkspacesNeedingDeletion,
  getWorkspacesForNotification,
  getUserEmail,
  getWorkspaceExportData,
  getWorkspaceExport,
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

  const { exportId, status, downloadUrl, expiresAt, errorMessage } = await request.json();

  try {
    const result = await ctx.runMutation(updateWorkspaceExportStatus as any, {
      exportId: exportId as any,
      status,
      downloadUrl,
      expiresAt,
      errorMessage,
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

/**
 * PR #4b-fix: returns the owner + workspace of an export so the
 * trigger task can email the requesting user on completion. Mirrors
 * the pattern of `httpGetWorkspaceExportData` — single-record
 * lookup gated by CONVEX_HTTP_KEY.
 */
export const httpGetWorkspaceExport = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  const { exportId } = await request.json();

  try {
    const exportDoc = await ctx.runQuery(getWorkspaceExport as any, {
      exportId: exportId as any,
    });
    if (!exportDoc) {
      return new Response(JSON.stringify({ error: "Export not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify(exportDoc), {
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

  const body = await request.json();
  const { instructorId, type } = body;

  if (!instructorId) {
    return new Response(JSON.stringify({ success: false, error: "Missing instructorId" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const normalizedType = typeMap[type] || type;
  const resolvedIdTyped = instructorId as any;

  try {
    const result = await ctx.runMutation(decrementInventory as any, {
      id: resolvedIdTyped,
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

  const body = await request.json();
  const { instructorId, type, quantity } = body;

  if (!instructorId) {
    return new Response(JSON.stringify({ success: false, error: "Missing instructorId" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const normalizedType = typeMap[type] || type;
  const resolvedIdTyped = instructorId as any;
  const qty = quantity || 1;

  try {
    let result;
    for (let i = 0; i < qty; i++) {
      result = await ctx.runMutation(incrementInventory as any, {
        id: resolvedIdTyped,
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

  const body = await request.json();
  const { instructorId, oneOnOneInventory, groupInventory } = body;

  if (!instructorId) {
    return new Response(JSON.stringify({ success: false, error: "Missing instructorId" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const resolvedIdTyped = instructorId as any;

  try {
    const updates: Record<string, any> = {};
    if (oneOnOneInventory !== undefined) {
      updates.oneOnOneInventory = oneOnOneInventory;
    }
    if (groupInventory !== undefined) {
      updates.groupInventory = groupInventory;
    }

    const result = await ctx.runMutation(updateInstructor as any, {
      id: resolvedIdTyped,
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

/** Syncs instructor inventory from admin (called by Inngest after Drizzle writes). Looks up by slug and creates/updates. */
export const httpAdminSyncInventory = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  const { slug, name, email, oneOnOneInventory, groupInventory, maxActiveStudents } = await request.json();

  try {
    // Look up existing instructor by slug using runQuery
    const existing: any = await ctx.runQuery(api.instructors.getInstructorBySlugForAdmin, { slug });

    if (existing) {
      // Update existing record using runMutation
      const updated = await ctx.runMutation(api.instructors.updateInstructor, {
        id: existing._id,
        name: name ?? undefined,
        email: email ?? undefined,
        oneOnOneInventory: oneOnOneInventory ?? existing.oneOnOneInventory,
        groupInventory: groupInventory ?? existing.groupInventory,
        maxActiveStudents: maxActiveStudents ?? existing.maxActiveStudents,
      });
      return new Response(JSON.stringify({ success: true, action: "updated", id: existing._id }), {
        headers: { "Content-Type": "application/json" },
      });
    } else {
      // Create new instructor record using runMutation. Intentionally
      // omit `userId` so the Clerk `user.created` webhook can claim
      // the row with the real Clerk user ID when the instructor signs
      // in. (Previously this wrote an `admin-${slug}` placeholder
      // that the webhook DID recognize and overwrite — but the
      // matching `seed-${slug}` placeholder from `seed-instructors.ts`
      // was not recognized, leaving some instructors unable to use
      // video calling. With the format-based placeholder check, both
      // legacy rows are healed on the next Clerk sign-in.)
      const id = await ctx.runMutation(api.instructors.createInstructor, {
        name: name ?? undefined,
        slug: slug,
        email: email ?? undefined,
        oneOnOneInventory: oneOnOneInventory ?? 0,
        groupInventory: groupInventory ?? 0,
        maxActiveStudents: maxActiveStudents ?? 10,
      });
      return new Response(JSON.stringify({ success: true, action: "created", id }), {
        headers: { "Content-Type": "application/json" },
      });
    }
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
  path: "/workspace/export/get",
  method: "POST",
  handler: httpGetWorkspaceExport,
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

/**
 * Ensure an admin-student workspace exists for a given student user.
 * Protected by CONVEX_HTTP_KEY. Returns { id, created }.
 */
http.route({
  path: "/workspaces/ensure-admin-student",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!verifyAuth(request)) return unauthorizedResponse();

    const { studentUserId } = await request.json();
    if (!studentUserId || typeof studentUserId !== "string") {
      return new Response(JSON.stringify({ error: "studentUserId is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const result = await ctx.runMutation(internal.adminWorkspaces.ensureAdminStudentWorkspace, {
        studentUserId,
      });
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      const message = (error as Error).message;
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }),
});

http.route({
  path: "/inventory/admin-sync",
  method: "POST",
  handler: httpAdminSyncInventory,
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
    studentBeforeAfterImages,
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

  const instructorId = await ctx.runMutation(api.instructors.createInstructor as any, {
    userId: `seed-${slug}`,
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
    oneOnOneInventory,
    groupInventory,
    maxActiveStudents: 10,
  });

  if (pricing?.oneOnOne) {
    await ctx.runMutation(api.products.createProduct as any, {
      instructorId,
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
      instructorId,
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

  if (studentBeforeAfterImages && studentBeforeAfterImages.length > 0) {
    for (const imageUrl of studentBeforeAfterImages) {
      await ctx.runMutation(api.instructors.createStudentResult as any, {
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

async function verifySvixSignature(
  secret: string,
  payload: string,
  timestamp: string,
  signature: string
): Promise<boolean> {
  const [signingString, expectedSig] = signature.split("v1=");
  if (!expectedSig) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const data = encoder.encode(`${timestamp}.${payload}`);
  const sigBuffer = await crypto.subtle.sign("HMAC", key, data);
  const sigArray = new Uint8Array(sigBuffer);

  const expectedBytes = Uint8Array.from(atob(expectedSig), (c) => c.charCodeAt(0));
  if (sigArray.length !== expectedBytes.length) return false;

  let result = 0;
  for (let i = 0; i < sigArray.length; i++) {
    result |= sigArray[i] ^ expectedBytes[i];
  }
  return result === 0;
}

export const httpClerkWebhook = httpAction(async (ctx, request) => {
  const CLERK_WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

  if (!CLERK_WEBHOOK_SECRET) {
    console.error("CLERK_WEBHOOK_SECRET is not configured");
    return new Response(JSON.stringify({ error: "Webhook not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const payloadString = await request.text();
  const svixId = request.headers.get("svix-id") ?? "";
  const svixTimestamp = request.headers.get("svix-timestamp") ?? "";
  const svixSignature = request.headers.get("svix-signature") ?? "";

  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response(JSON.stringify({ error: "Missing Svix headers" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const timestampAge = Math.abs(Date.now() - parseInt(svixTimestamp, 10) * 1000);
  if (timestampAge > 300000) {
    return new Response(JSON.stringify({ error: "Webhook timestamp too old" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const isValid = await verifySvixSignature(
    CLERK_WEBHOOK_SECRET,
    payloadString,
    svixTimestamp,
    svixSignature
  );

  if (!isValid) {
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = JSON.parse(payloadString);
  const eventType = body.type;
  const eventData = body.data;

  if (!eventData || !eventData.id) {
    return new Response(JSON.stringify({ error: "Invalid webhook payload" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  switch (eventType) {
    case "user.created": {
      const emailAddress = eventData.email_addresses?.[0]?.email_address;
      if (emailAddress) {
        await ctx.runAction(internal.instructors.linkClerkUserToInstructor, {
          userId: eventData.id,
          email: emailAddress,
        });
      }
      break;
    }
    case "user.deleted": {
      await ctx.runAction(internal.instructors.unlinkClerkUserFromInstructor, {
        userId: eventData.id,
      });
      break;
    }
    default:
      console.log("Ignored Clerk webhook event", eventType);
  }

  return new Response(null, { status: 200 });
});

http.route({
  path: "/webhooks/clerk",
  method: "POST",
  handler: httpClerkWebhook,
});

export const httpGetGuestSessionPacks = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  const guestPacks = await ctx.runQuery(internal.migrationQueries.getGuestSessionPacksForMigration);

  return new Response(JSON.stringify({ packs: guestPacks }), {
    headers: { "Content-Type": "application/json" },
  });
});

http.route({
  path: "/internal/guest-session-packs",
  method: "GET",
  handler: httpGetGuestSessionPacks,
});

export const httpLinkSessionPacksByEmail = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  let clerkUserId: string, email: string;
  try {
    ({ clerkUserId, email } = await request.json());
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Presence validation
  if (!clerkUserId || typeof clerkUserId !== "string" || !clerkUserId.trim()) {
    return new Response(JSON.stringify({ error: "Missing or empty clerkUserId" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!email || typeof email !== "string" || !email.trim()) {
    return new Response(JSON.stringify({ error: "Missing or empty email" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const result = await ctx.runMutation(internal.sessionPacks.linkSessionPacksByEmail, {
      clerkUserId: clerkUserId.trim(),
      email: email.trim().toLowerCase(),
    });
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

export const httpLinkSeatReservationsByEmail = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  let clerkUserId: string, email: string;
  try {
    ({ clerkUserId, email } = await request.json());
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Presence validation
  if (!clerkUserId || typeof clerkUserId !== "string" || !clerkUserId.trim()) {
    return new Response(JSON.stringify({ error: "Missing or empty clerkUserId" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!email || typeof email !== "string" || !email.trim()) {
    return new Response(JSON.stringify({ error: "Missing or empty email" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const result = await ctx.runMutation(internal.seatReservations.linkSeatReservationsByEmail, {
      clerkUserId: clerkUserId.trim(),
      email: email.trim().toLowerCase(),
    });
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

http.route({
  path: "/internal/link-session-packs",
  method: "POST",
  handler: httpLinkSessionPacksByEmail,
});

http.route({
  path: "/internal/link-seat-reservations",
  method: "POST",
  handler: httpLinkSeatReservationsByEmail,
});

/**
 * R14: bearer-auth HTTP endpoints for the secret-removal migration.
 * Each replaces a public action that previously required a `secret` arg
 * authenticated against `CONVEX_SERVER_SHARED_SECRET`. Callers now
 * authenticate with the `CONVEX_HTTP_KEY` bearer header. The legacy
 * public actions stay in place so in-flight callers do not break during
 * the WIDEN phase.
 */

export const httpCreateInstructorForClerkUser = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  let userId: string, email: string | undefined, name: string | undefined;
  try {
    ({ userId, email, name } = await request.json());
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!userId || typeof userId !== "string") {
    return new Response(JSON.stringify({ error: "Missing or invalid userId" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const result = await ctx.runAction(
      internal.instructors.createInstructorForClerkUserInternal,
      {
        userId,
        email,
        name,
        actorId: "platform-server",
        actorRole: "system",
      }
    );
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

export const httpDeactivateInstructorByUserId = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  let userId: string;
  try {
    ({ userId } = await request.json());
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!userId || typeof userId !== "string") {
    return new Response(JSON.stringify({ error: "Missing or invalid userId" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const result = await ctx.runAction(
      internal.instructors.deactivateInstructorByUserIdInternal,
      {
        userId,
        actorId: "platform-server",
        actorRole: "system",
      }
    );
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

export const httpServerVerifiedSetUserRole = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  let userId: string, role: "student" | "instructor" | "admin" | "video_editor";
  try {
    ({ userId, role } = await request.json());
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!userId || typeof userId !== "string") {
    return new Response(JSON.stringify({ error: "Missing or invalid userId" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (role !== "student" && role !== "instructor" && role !== "admin" && role !== "video_editor") {
    return new Response(JSON.stringify({ error: "Invalid role" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const result = await ctx.runMutation(internal.users.setUserRoleTrusted, {
      userId,
      role,
      actorId: "platform-server",
      actorRole: "system",
      audit: {
        action: "set_user_role_http",
        targetType: "user",
        targetId: userId,
        details: `Role set to ${role} via HTTP bearer-auth endpoint`,
      },
    });
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

export const httpServerVerifiedSetUserClerkId = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  let userId: string, clerkId: string;
  try {
    ({ userId, clerkId } = await request.json());
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!userId || typeof userId !== "string") {
    return new Response(JSON.stringify({ error: "Missing or invalid userId" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!clerkId || typeof clerkId !== "string") {
    return new Response(JSON.stringify({ error: "Missing or invalid clerkId" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const result = await ctx.runMutation(internal.users.setUserClerkId, {
      userId,
      clerkId,
      actorId: "platform-server",
      actorRole: "system",
    });
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

http.route({
  path: "/instructors/create-for-clerk-user",
  method: "POST",
  handler: httpCreateInstructorForClerkUser,
});

http.route({
  path: "/instructors/deactivate-by-user-id",
  method: "POST",
  handler: httpDeactivateInstructorByUserId,
});

http.route({
  path: "/users/set-role",
  method: "POST",
  handler: httpServerVerifiedSetUserRole,
});

http.route({
  path: "/users/set-clerk-id",
  method: "POST",
  handler: httpServerVerifiedSetUserClerkId,
});

const httpGetImagesNeedingMigration = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) {
    return unauthorizedResponse();
  }

  try {
    const images = await ctx.runQuery(api.workspaces.getImagesNeedingMigration, {});
    return new Response(JSON.stringify({ images }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

const httpMigrateWorkspaceImage = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) {
    return unauthorizedResponse();
  }

  let imageId: string;
  try {
    const body = await request.json();
    imageId = body.imageId;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!imageId || typeof imageId !== "string") {
    return new Response(JSON.stringify({ error: "Missing or invalid imageId" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const result = await ctx.runAction(api.workspaces.migrateWorkspaceImage, { imageId: imageId as any });
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

http.route({
  path: "/api/workspaces/getImagesNeedingMigration",
  method: "GET",
  handler: httpGetImagesNeedingMigration,
});

http.route({
  path: "/api/workspaces/migrateWorkspaceImage",
  method: "POST",
  handler: httpMigrateWorkspaceImage,
});

/**
 * Recording-transfer callback endpoints invoked by the Trigger.dev
 * task `transfer-daily-recording-to-b2` (see
 * `src/trigger/recording-transfer.ts`). All three share the same
 * auth model: the standard `CONVEX_HTTP_KEY` (already enforced by
 * `verifyAuth` above) PLUS an additional `X-Trigger-Callback-Secret`
 * header so a leaked Convex deploy key alone cannot be used to
 * forge a callback. The shared secret is
 * `TRIGGER_CONVEX_CALLBACK_SECRET` and is set identically on
 * both sides; this is the standard "two-key" pattern for
 * service-to-service callbacks.
 *
 * Why we don't put these in an `internalMutation`-only chain:
 * Trigger.dev runs in a different deployment than Convex and
 * cannot reach `ctx.runMutation` directly, so we accept HTTP and
 * forward into the internal mutation layer. The b2Key passed in
 * `attach-from-b2` is constrained to start with `recordings/` by
 * the mutation itself (defence in depth) so a forged callback
 * could not, for example, point `recordingUrl` at someone else's
 * B2 key.
 */

function verifyCallbackSecret(request: Request): boolean {
  const expected = process.env.TRIGGER_CONVEX_CALLBACK_SECRET;
  if (!expected) return false;
  const provided = request.headers.get("X-Trigger-Callback-Secret");
  if (provided === null) return false;
  // Constant-time compare on equal-length buffers; pad to a
  // fixed-length buffer so the timing-side-channel doesn't leak
  // the secret length.
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  const len = Math.max(a.length, b.length, 64);
  const aPadded = Buffer.alloc(len);
  const bPadded = Buffer.alloc(len);
  a.copy(aPadded);
  b.copy(bPadded);
  return a.length === b.length && timingSafeEqualStr(aPadded, bPadded);
}

function timingSafeEqualStr(a: Buffer, b: Buffer): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

const httpAttachRecordingFromB2Upload = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();
  if (!verifyCallbackSecret(request)) return unauthorizedResponse();
  const { sessionId, b2Key, durationSeconds, recordingId } = await request.json();
  if (typeof sessionId !== "string" || typeof b2Key !== "string") {
    return new Response(JSON.stringify({ error: "sessionId and b2Key are required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const result = await ctx.runMutation(internal.sessions.attachRecordingFromB2Upload, {
    sessionId: sessionId as any,
    b2Key,
    durationSeconds: typeof durationSeconds === "number" ? durationSeconds : undefined,
    recordingId: typeof recordingId === "string" ? recordingId : undefined,
  });
  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
  });
});

const httpMarkRecordingTransferRetrying = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();
  if (!verifyCallbackSecret(request)) return unauthorizedResponse();
  const { sessionId, attemptNumber } = await request.json();
  if (typeof sessionId !== "string" || typeof attemptNumber !== "number") {
    return new Response(JSON.stringify({ error: "sessionId and attemptNumber are required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const result = await ctx.runMutation(internal.sessions.markRecordingTransferRetrying, {
    sessionId: sessionId as any,
    attemptNumber,
  });
  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
  });
});

const httpMarkRecordingTransferFailed = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();
  if (!verifyCallbackSecret(request)) return unauthorizedResponse();
  const { sessionId, errorMessage, attempts } = await request.json();
  if (
    typeof sessionId !== "string" ||
    typeof errorMessage !== "string" ||
    typeof attempts !== "number"
  ) {
    return new Response(JSON.stringify({ error: "sessionId, errorMessage, and attempts are required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const result = await ctx.runMutation(internal.sessions.markRecordingTransferFailed, {
    sessionId: sessionId as any,
    errorMessage,
    attempts,
  });
  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
  });
});

http.route({
  path: "/recording-transfer/attach-from-b2",
  method: "POST",
  handler: httpAttachRecordingFromB2Upload,
});

http.route({
  path: "/recording-transfer/mark-retrying",
  method: "POST",
  handler: httpMarkRecordingTransferRetrying,
});

http.route({
  path: "/recording-transfer/mark-failed",
  method: "POST",
  handler: httpMarkRecordingTransferFailed,
});

/**
 * R12: recording-retention HTTP endpoints invoked by the
 * Trigger.dev schedules `cleanup-expired-call-recordings` and
 * `send-recording-retention-warnings` (see
 * `src/trigger/recording-retention.ts` and
 * `src/trigger/recording-retention-warnings.ts`). They follow
 * the same auth model as the workspace-retention routes
 * (`/workspace/retention/*`): `CONVEX_HTTP_KEY` only, because
 * the Trigger SDK schedules we run are *our* schedules (not
 * caller-supplied), so the second-key defence-in-depth from
 * `verifyCallbackSecret` is unnecessary.
 *
 * Cleanup is orchestrated in Trigger (so it can call
 * `@mentorships/storage:deleteFromB2`) and calls back here to
 * patch the session to the `purged` terminal state and write
 * a `deleted` retention notification row per recipient. This
 * split keeps Convex free of workspace-package imports while
 * still letting us atomically flip state in a single
 * transaction.
 */

const httpGetRecordingsNeedingCleanup = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  const recordings = await ctx.runQuery(
    internal.recordingRetention.getRecordingsNeedingCleanup,
    { now: Date.now() }
  );

  return new Response(JSON.stringify({ recordings }), {
    headers: { "Content-Type": "application/json" },
  });
});

const httpGetRecordingsForRetentionNotification = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  const notifications = await ctx.runQuery(
    internal.recordingRetention.getRecordingsForRetentionNotification,
    { now: Date.now() }
  );

  return new Response(JSON.stringify({ notifications }), {
    headers: { "Content-Type": "application/json" },
  });
});

const httpMarkRecordingDeleted = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  let sessionId: string | undefined;
  try {
    const body = await request.json();
    sessionId = body.sessionId;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!sessionId || typeof sessionId !== "string") {
    return new Response(JSON.stringify({ error: "Missing sessionId" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = await ctx.runMutation(
    internal.recordingRetention.markRecordingDeleted,
    { sessionId: sessionId as any }
  );

  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
  });
});

const httpCreateRecordingRetentionNotification = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  let body: {
    sessionId?: string;
    workspaceId?: string;
    recipientUserId?: string;
    recipientRole?: "instructor" | "student";
    notificationType?: "expiry_warning" | "deleted";
    recordingExpiresAt?: number;
    daysUntilDeletion?: number;
  } = {};
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const required: Array<keyof typeof body> = [
    "sessionId",
    "workspaceId",
    "recipientUserId",
    "recipientRole",
    "notificationType",
    "recordingExpiresAt",
    "daysUntilDeletion",
  ];
  for (const field of required) {
    if (body[field] === undefined) {
      return new Response(
        JSON.stringify({ error: `Missing required field: ${field}` }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  const result = await ctx.runMutation(
    internal.recordingRetention.createRecordingRetentionNotification,
    {
      sessionId: body.sessionId as any,
      workspaceId: body.workspaceId as any,
      recipientUserId: body.recipientUserId!,
      recipientRole: body.recipientRole!,
      notificationType: body.notificationType!,
      recordingExpiresAt: body.recordingExpiresAt!,
      daysUntilDeletion: body.daysUntilDeletion!,
    }
  );

  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
  });
});

http.route({
  path: "/recording-retention/needing-cleanup",
  method: "GET",
  handler: httpGetRecordingsNeedingCleanup,
});

http.route({
  path: "/recording-retention/for-notification",
  method: "GET",
  handler: httpGetRecordingsForRetentionNotification,
});

http.route({
  path: "/recording-retention/mark-deleted",
  method: "POST",
  handler: httpMarkRecordingDeleted,
});

http.route({
  path: "/recording-retention/notify",
  method: "POST",
  handler: httpCreateRecordingRetentionNotification,
});

export default http;