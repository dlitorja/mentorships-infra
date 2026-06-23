import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { deleteAllVersionsFromB2 } from "@mentorships/storage";

const CleanupRequestSchema = z.object({
  keys: z.array(z.string()).min(1),
});

export async function POST(
  request: NextRequest
): Promise<NextResponse> {
  try {
    await requireAdmin();

    const body = await request.json();
    const parsed = CleanupRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { keys } = parsed.data;

    const b2Keys = keys;
    const rawOrphanedFiles = await fetchQuery(
      api.instructorUploads.findOrphanedFiles,
      { b2Keys }
    );
    const orphanedKeySet = new Set(rawOrphanedFiles.map((o: { key: string }) => o.key));

    const keysToDelete = keys.filter((key) => orphanedKeySet.has(key));

    if (keysToDelete.length === 0) {
      return NextResponse.json({
        success: true,
        deleted: 0,
        failed: 0,
        total: keys.length,
        message: "No valid orphaned files to delete",
      });
    }

    const errors: string[] = [];
    let deleted = 0;

    for (const key of keysToDelete) {
      try {
        const result = await deleteAllVersionsFromB2(key);
        deleted += result.deleted;
        if (result.errors.length > 0) {
          errors.push(...result.errors.map((e) => `${key}: ${e}`));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        errors.push(`${key}: ${message}`);
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      deleted,
      failed: errors.length,
      total: keys.length,
      verifiedDeleted: keysToDelete.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("Orphaned files cleanup error:", error);

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