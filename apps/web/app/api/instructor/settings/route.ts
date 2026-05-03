import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { isUnauthorizedError } from "@/lib/errors";
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

const patchSchema = z.object({
  timeZone: z.string().min(1).nullable().optional(),
  workingHours: workingHoursSchema.nullable().optional(),
});

export async function GET(): Promise<NextResponse> {
  try {
    const user = await requireRoleForApi("mentor");
    const convex = getConvexClient();

    const mentor = await convex.query(api.instructors.getInstructorByUserId, {
      userId: user.id,
    });

    if (!mentor) {
      return NextResponse.json({ error: "Mentor not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      settings: {
        timeZone: mentor.timeZone ?? null,
        workingHours: mentor.workingHours ?? null,
      },
    });
  } catch (error) {
    console.error("Get instructor settings error:", error);
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireRoleForApi("mentor");
    const convex = getConvexClient();

    const mentor = await convex.query(api.instructors.getInstructorByUserId, {
      userId: user.id,
    });

    if (!mentor) {
      return NextResponse.json({ error: "Mentor not found" }, { status: 404 });
    }

    const body = await req.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const updated = await convex.mutation(api.instructors.updateMentorSchedulingSettings, {
      id: mentor._id,
      ...(parsed.data.timeZone !== undefined && parsed.data.timeZone !== null && { timeZone: parsed.data.timeZone }),
      ...(parsed.data.workingHours !== undefined && { workingHours: parsed.data.workingHours }),
    });

    return NextResponse.json({
      success: true,
      settings: {
        timeZone: updated?.timeZone ?? null,
        workingHours: updated?.workingHours ?? null,
      },
    });
  } catch (error) {
    console.error("Update instructor settings error:", error);
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}