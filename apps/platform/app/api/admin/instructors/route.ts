import { NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { requireRoleForApi } from "@/lib/auth-helpers";

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  return new ConvexHttpClient(convexUrl);
}

export async function GET(): Promise<NextResponse> {
  try {
    await requireRoleForApi("admin");

    const convex = getConvexClient();

    const instructors = await convex.query(api.instructors.getInstructorsForAdmin, {});

    const instructorsWithStats = (instructors as any[]).map((instructor) => {
      return {
        mentorId: instructor._id,
        userId: instructor.userId || "",
        email: instructor.email || instructor.name || "",
        oneOnOneInventory: instructor.oneOnOneInventory || 0,
        groupInventory: instructor.groupInventory || 0,
        maxActiveStudents: instructor.maxActiveStudents || 0,
        activeMenteeCount: 0,
        createdAt: instructor.createdAt
          ? new Date(instructor.createdAt).toISOString()
          : new Date(instructor._creationTime).toISOString(),
      };
    });

    return NextResponse.json({ instructors: instructorsWithStats });
  } catch (error) {
    console.error("Error fetching instructors:", error);
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message.includes("Forbidden")) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}