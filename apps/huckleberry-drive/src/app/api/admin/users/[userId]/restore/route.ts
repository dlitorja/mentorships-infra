import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

interface Params {
  params: Promise<{ userId: string }>;
}

export async function POST(
  _request: NextRequest,
  { params }: Params
): Promise<NextResponse> {
  try {
    const { userId } = await params;
    await requireAdmin();

    await fetchMutation(api.users.restoreUser, { userId });

    return NextResponse.json({ success: true, userId });
  } catch (error) {
    console.error("Restore user error:", error);

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