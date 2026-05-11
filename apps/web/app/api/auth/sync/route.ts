import { NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { auth } from "@clerk/nextjs/server";
import { clerkClient } from "@clerk/nextjs/server";

export async function GET() {
  try {
    const clerkAuth = await auth();
    const { userId: clerkUserId } = clerkAuth;
    if (!clerkUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const convex = getConvexClient();
    const token = await clerkAuth.getToken({ template: "convex" });
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    convex.setAuth(token);

    const client = await clerkClient();
    const clerkUser = await client.users.getUser(clerkUserId);
    const rawRole = clerkUser.publicMetadata?.role;
    const validRoles = ["student", "instructor", "admin", "video_editor"] as const;
    const role = typeof rawRole === "string" && validRoles.includes(rawRole as typeof validRoles[number])
      ? rawRole as typeof validRoles[number]
      : undefined;

    const user = await convex.mutation(api.users.syncUser, { role });

    if (!user) {
      return NextResponse.json({ error: "Failed to sync user" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      user: {
        id: user._id,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Error syncing user:", error);

    if (error instanceof Error && error.message.includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json(
      { error: "Failed to sync user" },
      { status: 500 }
    );
  }
}