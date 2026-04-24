import { NextRequest, NextResponse } from "next/server";
import { db, waitlist, eq, and, desc, inArray, isUnauthorizedError, isForbiddenError, instructors } from "@mentorships/db";
import { requireRoleForApi } from "@/lib/auth-helpers";
import { protectWithRateLimit } from "@/lib/ratelimit";
import { z } from "zod";
import { sendWaitlistNotifications } from "@/lib/email/waitlist-notification";

const waitlistNotificationSchema = z.object({
  instructorSlug: z.string(),
  mentorshipType: z.enum(["oneOnOne", "group"]),
  entryIds: z.array(z.number()).optional(),
});

const markNotifiedSchema = z.object({
  entryIds: z.array(z.number()),
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

    let query = db.select().from(waitlist).where(eq(waitlist.instructorSlug, slug));

    const entries = await query.orderBy(desc(waitlist.createdAt));

    const filtered = typeFilter
      ? entries.filter((e) => e.type === (typeFilter === "oneOnOne" ? "one-on-one" : "group"))
      : entries;

    const formatted = filtered.map((entry) => ({
      id: entry.id,
      email: entry.email,
      type: entry.type === "one-on-one" ? "oneOnOne" : "group",
      notified: entry.notified,
      createdAt: entry.createdAt?.toISOString() ?? null,
      updatedAt: entry.updatedAt?.toISOString() ?? null,
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

    const now = new Date();
    await db
      .update(waitlist)
      .set({ notified: true, updatedAt: now })
      .where(inArray(waitlist.id, validated.entryIds));

    return NextResponse.json({ success: true, updated: validated.entryIds.length });
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

    const ids = idsParam.split(",").map(Number).filter((n) => !isNaN(n));
    if (ids.length === 0) {
      return NextResponse.json({ success: true, deleted: 0 });
    }

    await db.delete(waitlist).where(inArray(waitlist.id, ids));

    return NextResponse.json({ success: true, deleted: ids.length });
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

    let entries;
    if (validated.entryIds && validated.entryIds.length > 0) {
      entries = await db
        .select()
        .from(waitlist)
        .where(
          and(
            eq(waitlist.instructorSlug, validated.instructorSlug),
            eq(
              waitlist.type,
              validated.mentorshipType === "oneOnOne" ? "one-on-one" : "group"
            ),
            inArray(waitlist.id, validated.entryIds)
          )
        );
    } else {
      entries = await db
        .select()
        .from(waitlist)
        .where(
          and(
            eq(waitlist.instructorSlug, validated.instructorSlug),
            eq(
              waitlist.type,
              validated.mentorshipType === "oneOnOne" ? "one-on-one" : "group"
            )
          )
        );
    }

    if (entries.length === 0) {
      return NextResponse.json({ success: true, sent: 0, message: "No entries to notify" });
    }

    const [instructor] = await db
      .select({ name: instructors.name })
      .from(instructors)
      .where(eq(instructors.slug, validated.instructorSlug))
      .limit(1);

    const instructorName = instructor?.name || validated.instructorSlug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

    const result = await sendWaitlistNotifications(
      entries.map((e) => ({
        id: String(e.id),
        email: e.email,
        createdAt: e.createdAt?.getTime() ?? Date.now(),
        notifiedAt: e.notified ? e.updatedAt?.getTime() ?? null : null,
      })),
      {
        instructorName: instructorName,
        instructorSlug: validated.instructorSlug,
        mentorshipType: validated.mentorshipType,
        purchaseUrl: `/instructors/${validated.instructorSlug}`,
      }
    );

    // Mark entries as notified after successful send
    if (result.success > 0) {
      const entryIds = entries.filter(e => !e.notified).map(e => e.id);
      if (entryIds.length > 0) {
        await db
          .update(waitlist)
          .set({ notified: true, updatedAt: new Date() })
          .where(inArray(waitlist.id, entryIds));
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