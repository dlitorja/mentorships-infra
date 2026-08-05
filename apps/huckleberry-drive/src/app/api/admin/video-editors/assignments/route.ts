import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { z } from "zod";

const assignmentSchema = z.object({
  videoEditorId: z.string().trim().min(1),
  instructorId: z.string().trim().min(1),
});

const patchSchema = assignmentSchema.extend({
  storageQuotaBytes: z.number().nonnegative().nullish(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin();
    const { getToken } = await auth();
    const token = await getToken({ template: "convex" }) ?? undefined;

    const body = await request.json();
    const parsed = assignmentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { videoEditorId, instructorId } = parsed.data;

    const result = await fetchMutation(
      api.videoEditorAssignments.createVideoEditorAssignment,
      { videoEditorId, instructorId },
      { token }
    );

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Create video editor assignment error:", error);

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

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin();
    const { getToken } = await auth();
    const token = await getToken({ template: "convex" }) ?? undefined;

    const body = await request.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { videoEditorId, instructorId, storageQuotaBytes } = parsed.data;

    await fetchMutation(
      api.videoEditorAssignments.setVideoEditorAssignmentQuotaByIds,
      {
        videoEditorId,
        instructorId,
        storageQuotaBytes,
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
