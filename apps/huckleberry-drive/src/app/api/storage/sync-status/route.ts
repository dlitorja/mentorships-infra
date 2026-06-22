import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { listAllB2Objects } from "@mentorships/storage/src/list";

interface User {
  _id: string;
  userId: string;
  role: string;
}

interface ExpiredDeletion {
  id: string;
  filename: string | undefined;
  s3Key: string | undefined;
  originalName: string;
  deletedAt: number;
  instructorId: string;
  size: number;
}

interface OrphanedFile {
  key: string;
}

export async function GET(
  _request: NextRequest
): Promise<NextResponse> {
  try {
    await requireAdmin() as User;

    const expiredDeletions = await fetchQuery(
      api.instructorUploads.getExpiredSoftDeletions
    ) as ExpiredDeletion[];

    const b2Objects = await listAllB2Objects();
    const b2Keys = b2Objects.map((obj) => obj.key);

    const orphanedFiles = await fetchQuery(
      api.instructorUploads.findOrphanedFiles,
      { b2Keys }
    ) as OrphanedFile[];

    const orphanedWithMeta = b2Objects
      .filter((obj) => orphanedFiles.some((o) => o.key === obj.key))
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
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}