import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { auth } from "@clerk/nextjs/server";

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

    const convex = getConvexClient();
    const clerkAuth = await auth();
    const token = await clerkAuth.getToken({ template: "convex" });
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    convex.setAuth(token);

    // Use admin query to fetch students by instructor id
    const result = await convex.query(api.admin.getStudentsForAdmin as any, {
      instructorId: id,
      page: 1,
      pageSize: 100,
    });

    // Normalize to a simple students array for the UI
    return NextResponse.json({ students: result.items });
  } catch (error) {
    console.error("Error fetching instructor students:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load students" },
      { status: 500 }
    );
  }
}
