import { NextResponse } from "next/server";
import { auth, UnauthorizedError, ForbiddenError } from "@clerk/nextjs/server";
import { requireAdmin } from "@/lib/auth";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

export async function GET(): Promise<NextResponse> {
  try {
    await requireAdmin();
    const { getToken } = await auth();
    const convexToken = await getToken({ template: "convex" }) ?? undefined;

    const result = await fetchQuery(api.hdInvitations.listHdInvitations, {}, { token: convexToken });

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