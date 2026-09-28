import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/auth";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ videoEditorId: string }> }
): Promise<NextResponse> {
  try {
    await requireAdmin();
    const { getToken } = await auth();
    const token = await getToken({ template: "convex" }) ?? undefined;

    const { videoEditorId } = await params;
    if (!videoEditorId) {
      return NextResponse.json({ error: "Missing videoEditorId" }, { status: 400 });
    }

    const result = await fetchMutation(
      api.videoEditorAssignments.removeVideoEditorOpenAssignment,
      { videoEditorId },
      { token }
    );

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Remove open video editor assignment error:", error);

    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
