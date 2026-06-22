import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { listAllB2Objects } from "@mentorships/storage";

const UserSchema = z.object({
  _id: z.string(),
  userId: z.string(),
  role: z.string(),
});

const ExpiredDeletionSchema = z.object({
  id: z.string(),
  filename: z.string().optional(),
  s3Key: z.string().optional(),
  originalName: z.string(),
  deletedAt: z.number(),
  instructorId: z.string(),
  size: z.number(),
});

const OrphanedFileSchema = z.object({
  key: z.string(),
});

export async function GET(
  _request: NextRequest
): Promise<NextResponse> {
  try {
    const adminUser = await requireAdmin();
    UserSchema.parse(adminUser);

    const rawExpiredDeletions = await fetchQuery(
      api.instructorUploads.getExpiredSoftDeletions
    );
    const expiredDeletions = z.array(ExpiredDeletionSchema).parse(rawExpiredDeletions);

    const b2Objects = await listAllB2Objects();
    const b2Keys = b2Objects.map((obj) => obj.key);

    const rawOrphanedFiles = await fetchQuery(
      api.instructorUploads.findOrphanedFiles,
      { b2Keys }
    );
    const orphanedFiles = z.array(OrphanedFileSchema).parse(rawOrphanedFiles);

    const orphanedKeysSet = new Set(orphanedFiles.map((o) => o.key));
    const orphanedWithMeta = b2Objects
      .filter((obj) => orphanedKeysSet.has(obj.key))
      .map((obj) => ({
        key: obj.key,
        size: obj.size,
        lastModified: obj.lastModified,
      }));

    const totalOrphanedSize = orphanedWithMeta.reduce((sum, f) => sum + f.size, 0);

    return NextResponse.json({
      expiredDeletions: expiredDeletions.map((d) => ({
        id: d.id,
        filename: d.filename,
        s3Key: d.s3Key,
        originalName: d.originalName,
        deletedAt: d.deletedAt,
        daysExpired: Math.floor((Date.now() - d.deletedAt) / (24 * 60 * 60 * 1000)),
        instructorId: d.instructorId,
        size: d.size,
      })),
      orphanedInB2: orphanedWithMeta,
      summary: {
        expiredCount: expiredDeletions.length,
        orphanedCount: orphanedWithMeta.length,
        totalOrphanedSize,
        totalB2Objects: b2Objects.length,
      },
    });
  } catch (error) {
    console.error("Storage sync status error:", error);

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