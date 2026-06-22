import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { fetchQuery, fetchAction } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { UnauthorizedError, ForbiddenError } from "@/lib/auth";

async function requireAdminWithToken() {
  const { userId, getToken } = await auth();
  if (!userId) throw new UnauthorizedError("Must be logged in");

  const token = await getToken({ template: "convex" }) ?? undefined;
  if (!token) throw new UnauthorizedError("Could not get auth token");

  const user = await fetchAction(api.users.getUserByClerkIdServer, { userId }, { token });
  if (!user || user.role !== "admin") {
    throw new ForbiddenError("Must be an admin");
  }
  return { userId, token };
}

export async function GET(): Promise<NextResponse> {
  try {
    const { token } = await requireAdminWithToken();

    const result = await fetchQuery(api.hdInvitations.listHdInvitations, {
      status: undefined,
      role: undefined,
      limit: undefined,
      offset: undefined,
    }, { token });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Invitations list error:", error);

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