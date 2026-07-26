import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireInstructor, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { STORAGE_LIMIT_BYTES } from "@/lib/limits";

export async function GET(): Promise<NextResponse> {
  try {
    const dbUser = await requireInstructor();
    const { getToken } = await auth();
    const convexToken = await getToken({ template: "convex" }) ?? undefined;

    if (dbUser.role === "admin") {
      const stats = await fetchQuery(
        api.instructorUploads.getTotalStorageStats,
        {},
        { token: convexToken }
      );

      return NextResponse.json({
        usedBytes: stats.activeBytes,
        limitBytes: null,
        fileCount: stats.activeFiles,
        instructorCount: stats.instructorCount,
      });
    }

    if (dbUser.role === "video_editor") {
      const assignments = await fetchQuery(
        api.videoEditorAssignments.getVideoEditorAssignmentsWithStorage,
        { videoEditorId: dbUser.userId },
        { token: convexToken }
      );

      let usedBytes = 0;
      let fileCount = 0;
      let limitBytes = 0;
      let hasUnlimited = false;

      for (const assignment of assignments) {
        usedBytes += assignment.usedBytes;
        fileCount += assignment.fileCount;
        const quota = assignment.assignment.storageQuotaBytes;
        if (quota === undefined || quota === null) {
          hasUnlimited = true;
        } else {
          limitBytes += quota;
        }
      }

      return NextResponse.json({
        usedBytes,
        limitBytes: hasUnlimited ? null : limitBytes,
        fileCount,
      });
    }

    const uploads = await fetchQuery(
      api.instructorUploads.getInstructorUploads,
      { instructorId: dbUser.userId },
      { token: convexToken }
    );
    const nonDeleted = uploads.filter((u) => u.status !== "deleted");
    const usedBytes = nonDeleted.reduce((sum, u) => sum + u.size, 0);
    const fileCount = nonDeleted.length;

    return NextResponse.json({
      usedBytes,
      limitBytes: STORAGE_LIMIT_BYTES,
      fileCount,
    });
  } catch (error) {
    console.error("Storage usage error:", error);

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