import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { auth } from "@clerk/nextjs/server";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  return new ConvexHttpClient(convexUrl);
}

/**
 * GET /api/admin/instructors/[id]/students
 * Returns students associated with the given instructor for the admin dashboard.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const { id } = await params;
    if (!id || typeof id !== "string" || id.trim().length === 0) {
      return NextResponse.json({ error: "Bad Request" }, { status: 400 });
    }

    const convex = getConvexClient();
    const clerkAuth = await auth();
    const token = await clerkAuth.getToken({ template: "convex" });
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    convex.setAuth(token);

    // Use admin query to fetch students by instructor id
    const result = await convex.query(api.admin.getStudentsForAdmin, {
      instructorId: id,
      page: 1,
      pageSize: 100,
    });

    // Validate response shape before returning
    const StudentSchema = z.object({
      id: z.string(),
      userId: z.string(),
      email: z.string().nullable(),
      instructorId: z.string(),
      instructorName: z.string().nullable(),
      instructorSlug: z.string().nullable(),
      totalSessions: z.number(),
      remainingSessions: z.number(),
      purchasedAt: z.number(),
      expiresAt: z.number().nullable(),
      status: z.enum(["active", "depleted", "expired", "refunded"]),
      createdAt: z.number(),
    });

    const StudentsResponseSchema = z.object({
      items: z.array(StudentSchema),
      total: z.number(),
      page: z.number(),
      pageSize: z.number(),
    });
    const parsed = StudentsResponseSchema.safeParse(result);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid students payload" }, { status: 500 });
    }
    return NextResponse.json({ students: parsed.data.items });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }
    console.error("Error fetching instructor students:", error);
    return NextResponse.json({ error: "Failed to load students" }, { status: 500 });
  }
}
