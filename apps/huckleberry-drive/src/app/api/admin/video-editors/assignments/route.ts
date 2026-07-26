import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/auth";

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin();
    const { getToken } = await auth();
    const token = await getToken({ template: "convex" }) ?? undefined;

    const body = await request.json();
    const { videoEditorId, instructorId, storageQuotaBytes } = body as {
      videoEditorId: string;
      instructorId: string;
      storageQuotaBytes?: number | null;
    };

    if (!videoEditorId || !instructorId) {
      return NextResponse.json(
        { error: "videoEditorId and instructorId are required" },
        { status: 400 }
      );
    }

    const quota =
      storageQuotaBytes === null || storageQuotaBytes === undefined
        ? undefined
        : Number(storageQuotaBytes);

    if (quota !== undefined && (!Number.isFinite(quota) || quota < 0)) {
      return NextResponse.json(
        { error: "storageQuotaBytes must be a non-negative number" },
        { status: 400 }
      );
    }

    await fetchMutation(
      api.videoEditorAssignments.setVideoEditorAssignmentQuotaByIds,
      {
        videoEditorId,
        instructorId,
        storageQuotaBytes: quota,
      },
      { token }
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update video editor quota error:", error);

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
