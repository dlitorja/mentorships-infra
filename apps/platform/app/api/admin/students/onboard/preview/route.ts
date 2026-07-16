import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { requireAdminOrSupportForApi } from "@/lib/auth-helpers";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { auth } from "@clerk/nextjs/server";

const previewSchema = z.object({
  email: z.string().email("Invalid email address"),
  instructors: z
    .array(
      z.object({
        instructorId: z.string(),
        sessionsPerInstructor: z.number().int().min(1).default(4),
        expiresAt: z.number().int().positive().optional(),
      })
    )
    .min(1, "At least one instructor is required"),
  isSeparateStudentRecord: z.boolean().optional(),
  notes: z.string().optional(),
  capacityOverrideReason: z.string().optional(),
});

/**
 * POST /api/admin/students/onboard/preview
 *
 * Preview-only path of the two-phase form. Calls
 * `convex.adminOnboarding.previewAdminOnboarding` and returns the
 * per-instructor view + warnings to the form. Zero side effects — the
 * admin uses this output to render the preview panel before clicking
 * "Confirm and Send".
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdminOrSupportForApi();

    const body = await req.json();
    const parsed = previewSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const convex = getConvexClient();
    const clerkAuth = await auth();
    const token = await clerkAuth.getToken({ template: "convex" });
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    convex.setAuth(token);

    const preview = await convex.query(
      api.adminOnboarding.previewAdminOnboarding,
      {
        email: parsed.data.email,
        instructors: parsed.data.instructors.map((i) => ({
          instructorId: i.instructorId as any,
          sessionsPerInstructor: i.sessionsPerInstructor,
          expiresAt: i.expiresAt,
        })),
        isSeparateStudentRecord: parsed.data.isSeparateStudentRecord,
        notes: parsed.data.notes,
        capacityOverrideReason: parsed.data.capacityOverrideReason,
      }
    );

    return NextResponse.json(preview);
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: admin or support role required" }, { status: 403 });
    }
    console.error("Error previewing admin onboarding:", error);
    return NextResponse.json({ error: "Failed to preview admin onboarding" }, { status: 500 });
  }
}
