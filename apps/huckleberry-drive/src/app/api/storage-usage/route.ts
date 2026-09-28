import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireInstructor, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

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
      // Use the editor's total active footprint from `by_uploadedById` so
      // the dashboard reflects what's still in B2 even when open access
      // has been revoked (per-assignment views would otherwise underreport
      // because specific rows do not cover uploads under a now-revoked
      // open row).
      const stats = await fetchQuery(
        api.instructorUploads.getVideoEditorTotalStorageStats,
        { videoEditorId: dbUser.userId },
        { token: convexToken }
      );

      const assignments = await fetchQuery(
        api.videoEditorAssignments.getVideoEditorAssignments,
        { videoEditorId: dbUser.userId },
        { token: convexToken }
      );

      // The total footprint is informational; quota enforcement is
      // per-instructor and runs separately in `createUpload`. The limit
      // reported here is the union of quota-bearing SPECIFIC assignments
      // so the editor can see whether their current scope has any caps.
      // Open assignments are deliberately excluded: they have no per-
      // instructor quota by design, so including them would incorrectly
      // report 'unlimited' even when a specific assignment in the same
      // mix has a real cap.
      //
      // Special case: when there are NO specific assignments (open-
      // only), the limit is 'unlimited' because the editor can upload
      // to any instructor with no cap.
      let limitBytes = 0;
      let hasUnlimited = false;
      let hasSpecific = false;
      for (const assignment of assignments) {
        if (assignment.instructorId === undefined) continue;
        hasSpecific = true;
        const quota = assignment.storageQuotaBytes;
        if (quota === undefined || quota === null) {
          hasUnlimited = true;
        } else {
          limitBytes += quota;
        }
      }
      if (!hasSpecific) {
        hasUnlimited = true;
        limitBytes = 0;
      }

      return NextResponse.json({
        usedBytes: stats.usedBytes,
        limitBytes: hasUnlimited ? null : limitBytes,
        fileCount: stats.fileCount,
        // Surface to the client so the UI can warn when the editor's
        // history exceeded the single-page scan cap
        // (TOTAL_STORAGE_STATS_PAGE_SIZE = 1000). The proper fix is a
        // denormalized counter on `users` (tracked as Linear HUC-58).
        truncated: stats.truncated ?? false,
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
      limitBytes: null,
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