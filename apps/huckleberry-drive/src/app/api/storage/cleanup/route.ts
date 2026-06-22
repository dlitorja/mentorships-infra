import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { fetchMutation, fetchQuery, fetchAction } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

interface User {
  _id: string;
  userId: string;
  role: string;
}

interface CleanupResult {
  success: boolean;
  cleanupId: string;
  totalToCleanup: number;
  status: "completed" | "processing";
  errors?: string[];
}

export async function POST(
  _request: NextRequest
): Promise<NextResponse> {
  try {
    await requireAdmin() as User;

    const expiredDeletions = await fetchQuery(
      api.instructorUploads.getExpiredSoftDeletions
    ) as Array<{ id: string; filename: string | undefined; s3Key: string | undefined }>;

    if (expiredDeletions.length === 0) {
      return NextResponse.json({
        success: true,
        cleanupId: `cleanup-${Date.now()}`,
        totalToCleanup: 0,
        status: "completed",
        message: "No expired deletions to clean up",
      });
    }

    const cleanupId = `cleanup-${Date.now()}`;
    const errors: string[] = [];

    for (const deletion of expiredDeletions) {
      try {
        const result = await fetchAction(
          api.instructorUploads.cleanupExpiredSoftDelete,
          { uploadId: deletion.id }
        ) as { success: boolean; error?: string };

        if (!result.success && result.error) {
          errors.push(`${deletion.id}: ${result.error}`);
        }
      } catch (err) {
        errors.push(`${deletion.id}: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    }

    const status = errors.length === expiredDeletions.length ? "failed" : errors.length > 0 ? "partial" : "completed";

    return NextResponse.json({
      success: status !== "failed",
      cleanupId,
      totalToCleanup: expiredDeletions.length,
      cleanedUp: expiredDeletions.length - errors.length,
      failed: errors.length,
      status,
      errors: errors.length > 0 ? errors : undefined,
    } as CleanupResult & { cleanedUp: number; failed: number });
  } catch (error) {
    console.error("Storage cleanup error:", error);

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