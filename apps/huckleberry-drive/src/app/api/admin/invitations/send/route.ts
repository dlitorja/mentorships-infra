import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { fetchQuery, fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { UnauthorizedError, ForbiddenError } from "@/lib/auth";

async function requireAdminWithToken() {
  const { userId, getToken } = await auth();
  if (!userId) throw new UnauthorizedError("Must be logged in");

  const token = await getToken({ template: "convex" }) ?? undefined;
  if (!token) throw new UnauthorizedError("Could not get auth token");

  const user = await fetchQuery(api.users.getUserByClerkIdServer, { userId }, { token });
  if (!user || user.role !== "admin") {
    throw new ForbiddenError("Must be an admin");
  }
  return { userId, token };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { token } = await requireAdminWithToken();

    const body = await request.json();
    const { email, role, expiresInDays } = body;

    if (!email || !role) {
      return NextResponse.json(
        { error: "Email and role are required" },
        { status: 400 }
      );
    }

    const validRoles = ["student", "instructor", "admin", "video_editor"];
    if (!validRoles.includes(role)) {
      return NextResponse.json(
        { error: "Invalid role" },
        { status: 400 }
      );
    }

    const invitationId = await fetchMutation(api.hdInvitations.createHdInvitation, {
      email,
      role,
      expiresInDays: expiresInDays ?? 7,
    }, { token });

    return NextResponse.json({ invitationId });
  } catch (error) {
    console.error("Create invitation error:", error);

    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}