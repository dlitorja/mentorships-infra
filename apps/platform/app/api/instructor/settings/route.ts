import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { requireRoleForApi } from "@/lib/auth-helpers";

const intervalSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
});

const workingHoursSchema = z
  .record(z.string(), z.array(intervalSchema))
  .superRefine((rec, ctx) => {
    for (const key of Object.keys(rec)) {
      const day = Number(key);
      if (!Number.isInteger(day) || day < 0 || day > 6) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: "Day must be an integer between 0 and 6",
        });
      }
    }
  })
  .transform((rec) => {
    const out: Record<string, Array<{ start: string; end: string }>> = {};
    for (const [k, v] of Object.entries(rec)) {
      const day = Number(k);
      out[String(day)] = v;
    }
    return out;
  });

const blockedDateRangeSchema = z.object({
  start: z.string(),
  end: z.string(),
  label: z.string().optional(),
});

const patchSchema = z.object({
  timeZone: z.string().min(1).nullable().optional(),
  workingHours: workingHoursSchema.nullable().optional(),
  bufferMinutesBetweenSessions: z.number().int().min(0).max(60).nullable().optional(),
  minBookingLeadMinutes: z.number().int().min(0).max(10080).nullable().optional(),
  maxBookingAdvanceDays: z.number().int().min(1).max(365).nullable().optional(),
  blockedDateRanges: z.array(blockedDateRangeSchema).nullable().optional(),
});

function logDebug(...args: unknown[]): void {
  if (process.env.NODE_ENV !== "production") {
    console.log(...args);
  }
}

/**
 * GET /api/instructor/settings
 * Returns the authenticated instructor's scheduling settings (timezone, working hours).
 * Requires instructor role. Returns timeZone and workingHours from Convex.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const user = await requireRoleForApi("instructor");
    const convex = getConvexClient();

    const instructor = await convex.query(api.instructors.getInstructorByUserId, {
      userId: user.id,
    });

    if (!instructor) {
      return NextResponse.json({ error: "Instructor not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      settings: {
        timeZone: instructor.timeZone ?? null,
        workingHours: instructor.workingHours ?? null,
        bufferMinutesBetweenSessions: instructor.bufferMinutesBetweenSessions ?? null,
        minBookingLeadMinutes: instructor.minBookingLeadMinutes ?? null,
        maxBookingAdvanceDays: instructor.maxBookingAdvanceDays ?? null,
        blockedDateRanges: instructor.blockedDateRanges ?? null,
      },
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Instructor role required" }, { status: 403 });
    }
    console.error("Get instructor settings error:", error);
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
  }
}

/**
 * PATCH /api/instructor/settings
 * Updates the authenticated instructor's scheduling settings.
 * Requires instructor role. Updates workingHours and (if non-null) timeZone.
 * Note: null timeZone values are silently dropped; the field cannot be cleared
 * via this endpoint. Working hours must be valid HH:MM format per day (0=Sunday-6=Saturday).
 */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireRoleForApi("instructor");
    const convex = getConvexClient();

    const instructor = await convex.query(api.instructors.getInstructorByUserId, {
      userId: user.id,
    });

    if (!instructor) {
      return NextResponse.json({ error: "Instructor not found" }, { status: 404 });
    }

    const body = await req.json();
    logDebug("[DEBUG PATCH /api/instructor/settings] body keys:", Object.keys(body).join(","));
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      logDebug("[DEBUG PATCH /api/instructor/settings] parse failed, issues:", parsed.error.issues.length);
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.issues },
        { status: 400 }
      );
    }

    logDebug("[DEBUG PATCH /api/instructor/settings] timeZone:", parsed.data.timeZone ? `(set: ${parsed.data.timeZone.length} chars)` : "(empty)", "workingHours keys:", parsed.data.workingHours ? Object.keys(parsed.data.workingHours).join(",") || "none" : "(not set)", "buffer:", parsed.data.bufferMinutesBetweenSessions, "minLead:", parsed.data.minBookingLeadMinutes, "maxAdvance:", parsed.data.maxBookingAdvanceDays);

    const updated = await convex.mutation(api.instructors.updateInstructorSchedulingSettings, {
      id: instructor._id,
      ...(parsed.data.timeZone != null && { timeZone: parsed.data.timeZone }),
      ...(parsed.data.workingHours != null && { workingHours: parsed.data.workingHours }),
      ...(parsed.data.bufferMinutesBetweenSessions != null && { bufferMinutesBetweenSessions: parsed.data.bufferMinutesBetweenSessions }),
      ...(parsed.data.minBookingLeadMinutes != null && { minBookingLeadMinutes: parsed.data.minBookingLeadMinutes }),
      ...(parsed.data.maxBookingAdvanceDays != null && { maxBookingAdvanceDays: parsed.data.maxBookingAdvanceDays }),
      ...(parsed.data.blockedDateRanges != null && { blockedDateRanges: parsed.data.blockedDateRanges }),
    });
    logDebug("[DEBUG PATCH /api/instructor/settings] updated timeZone:", updated?.timeZone ? `(set: ${updated.timeZone.length} chars)` : "(empty)");

    return NextResponse.json({
      success: true,
      settings: {
        timeZone: updated?.timeZone ?? null,
        workingHours: updated?.workingHours ?? null,
        bufferMinutesBetweenSessions: updated?.bufferMinutesBetweenSessions ?? null,
        minBookingLeadMinutes: updated?.minBookingLeadMinutes ?? null,
        maxBookingAdvanceDays: updated?.maxBookingAdvanceDays ?? null,
        blockedDateRanges: updated?.blockedDateRanges ?? null,
      },
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Instructor role required" }, { status: 403 });
    }
    console.error("Update instructor settings error:", error);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}