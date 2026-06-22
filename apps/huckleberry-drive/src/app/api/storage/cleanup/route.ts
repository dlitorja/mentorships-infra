import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { fetchQuery, fetchAction } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

const UserSchema = z.object({
  _id: z.string(),
  userId: z.string(),
  role: z.string(),
});

const ExpiredDeletionSchema = z.object({
  id: z.string(),
  filename: z.string().optional(),
  s3Key: z.string().optional(),
});

const CleanupActionResultSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});

interface CleanupResult {
  success: boolean;
  cleanupId: string;
  totalToCleanup: number;
  status: "completed" | "processing" | "partial" | "failed";
  errors?: string[];
}

export async function POST(
  _request: NextRequest
): Promise<NextResponse> {
  try {
    const adminUser = await requireAdmin();
    UserSchema.parse(adminUser);

    const rawExpiredDeletions = await fetchQuery(
      api.instructorUploads.getExpiredSoftDeletions
    );
    const expiredDeletions = z.array(ExpiredDeletionSchema).parse(rawExpiredDeletions);

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
        const rawResult = await fetchAction(
          api.instructorUploads.cleanupExpiredSoftDelete,
          { uploadId: deletion.id }
        );
        const result = CleanupActionResultSchema.parse(rawResult);

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
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}