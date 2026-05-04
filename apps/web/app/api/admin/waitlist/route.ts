import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { requireRoleForApi } from "@/lib/auth-helpers";
import { protectWithRateLimit } from "@/lib/ratelimit";
import { z } from "zod";
import { sendWaitlistNotifications } from "@/lib/email/waitlist-notification";

const waitlistNotificationSchema = z.object({
  instructorSlug: z.string(),
  mentorshipType: z.enum(["oneOnOne", "group"]),
  entryIds: z.array(z.string()).optional(),
});

const markNotifiedSchema = z.object({
  entryIds: z.array(z.string()),
});

/** Fetch waitlist entries for an instructor by slug */
export async function GET(
  request: NextRequest
): Promise<NextResponse> {
  const rateLimitResponse = await protectWithRateLimit(request, { policy: "default" });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    await requireRoleForApi("admin");

    const { searchParams } = new URL(request.url);
    const slug = searchParams.get("slug");
    const typeFilter = searchParams.get("type");

    if (!slug) {
      return NextResponse.json({ error: "Missing slug parameter" }, { status: 400 });
    }

    const convex = getConvexClient();
    const mentorshipType = typeFilter === "oneOnOne" || typeFilter === "group" ? typeFilter : undefined;
    const entries = await convex.query(api.waitlist.getWaitlistForInstructor, {
      instructorSlug: slug,
      mentorshipType,
    });

    const formatted = entries.map((entry) => ({
      id: entry._id,
      email: entry.email,
      type: entry.mentorshipType,
      notified: !!entry.notifiedAt,
      createdAt: new Date(entry.createdAt).toISOString(),
      notifiedAt: entry.notifiedAt ? new Date(entry.notifiedAt).toISOString() : null,
    }));

    return NextResponse.json({ items: formatted });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }

    console.error("Error fetching waitlist:", error);
    return NextResponse.json({ error: "Failed to fetch waitlist" }, { status: 500 });
  }
}

/** Mark waitlist entries as notified */
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const rateLimitResponse = await protectWithRateLimit(request, { policy: "default" });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    await requireRoleForApi("admin");

    const body = await request.json();
    const validated = markNotifiedSchema.parse(body);

    if (validated.entryIds.length === 0) {
      return NextResponse.json({ success: true, updated: 0 });
    }

    const convex = getConvexClient();
    const result = await convex.mutation(api.waitlist.markNotified, {
      ids: validated.entryIds as any,
    });

    return NextResponse.json({ success: true, updated: result.count });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request", details: error.issues }, { status: 400 });
    }

    console.error("Error marking waitlist entries as notified:", error);
    return NextResponse.json({ error: "Failed to mark as notified" }, { status: 500 });
  }
}

/** Delete waitlist entries by IDs */
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const rateLimitResponse = await protectWithRateLimit(request, { policy: "default" });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    await requireRoleForApi("admin");

    const { searchParams } = new URL(request.url);
    const idsParam = searchParams.get("ids");
    if (!idsParam) {
      return NextResponse.json({ error: "Missing ids parameter" }, { status: 400 });
    }

    const ids = idsParam.split(",").filter((id) => id.length > 0);
    if (ids.length === 0) {
      return NextResponse.json({ success: true, deleted: 0 });
    }

    const convex = getConvexClient();
    const result = await convex.mutation(api.waitlist.removeMultipleFromWaitlist, {
      ids: ids as any,
    });

    return NextResponse.json({ success: true, deleted: result.count });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }

    console.error("Error deleting waitlist entries:", error);
    return NextResponse.json({ error: "Failed to delete entries" }, { status: 500 });
  }
}

/** Send notification emails to waitlist entries */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const rateLimitResponse = await protectWithRateLimit(request, { policy: "default" });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    await requireRoleForApi("admin");

    const body = await request.json();
    const validated = waitlistNotificationSchema.parse(body);

    const convex = getConvexClient();

    let entries;
    if (validated.entryIds && validated.entryIds.length > 0) {
      const allEntries = await convex.query(api.waitlist.getWaitlistForInstructor, {
        instructorSlug: validated.instructorSlug,
        mentorshipType: validated.mentorshipType,
      });
      const idSet = new Set(validated.entryIds);
      entries = allEntries.filter((e) => idSet.has(e._id));
    } else {
      entries = await convex.query(api.waitlist.getWaitlistForInstructor, {
        instructorSlug: validated.instructorSlug,
        mentorshipType: validated.mentorshipType,
      });
    }

    if (entries.length === 0) {
      return NextResponse.json({ success: true, sent: 0, message: "No entries to notify" });
    }

    const instructorResult = await convex.query(api.instructors.getInstructorBySlugForAdmin, {
      slug: validated.instructorSlug,
    });

    const instructorName = instructorResult?.name ||
      validated.instructorSlug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

    const result = await sendWaitlistNotifications(
      entries.map((e) => ({
        id: e._id,
        email: e.email,
        createdAt: e.createdAt,
        notifiedAt: e.notifiedAt ?? null,
      })),
      {
        instructorName,
        instructorSlug: validated.instructorSlug,
        mentorshipType: validated.mentorshipType,
        purchaseUrl: `/instructors/${validated.instructorSlug}`,
      }
    );

    if (result.success > 0 && result.failed === 0) {
      const unnotifiedEntries = entries.filter((e) => !e.notifiedAt);
      if (unnotifiedEntries.length > 0) {
        await convex.mutation(api.waitlist.markNotified, {
          ids: unnotifiedEntries.map((e) => e._id),
        });
      }
    }

    return NextResponse.json({
      success: true,
      sent: result.success,
      failed: result.failed,
      error: result.error,
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request", details: error.issues }, { status: 400 });
    }

    console.error("Error sending waitlist notifications:", error);
    return NextResponse.json({ error: "Failed to send notifications" }, { status: 500 });
  }
}