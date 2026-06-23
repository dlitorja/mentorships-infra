import { NextResponse } from "next/server";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { listAllB2Objects } from "@mentorships/storage";

interface OrphanedFile {
  key: string;
  size: number;
  lastModified: string;
}

export async function GET(): Promise<NextResponse> {
  try {
    await requireAdmin();

    const b2Objects = await listAllB2Objects();
    const b2Keys = b2Objects.map((obj) => obj.key);

    const rawOrphanedFiles = await fetchQuery(
      api.instructorUploads.findOrphanedFiles,
      { b2Keys }
    );

    const orphanedFiles: OrphanedFile[] = b2Objects
      .filter((obj) => rawOrphanedFiles.some((o: { key: string }) => o.key === obj.key))
      .map((obj) => ({
        key: obj.key,
        size: obj.size,
        lastModified: obj.lastModified instanceof Date ? obj.lastModified.toISOString() : String(obj.lastModified),
      }));

    const totalSize = orphanedFiles.reduce((sum, f) => sum + f.size, 0);

    return NextResponse.json({
      files: orphanedFiles,
      totalCount: orphanedFiles.length,
      totalBytes: totalSize,
    });
  } catch (error) {
    console.error("Orphaned files list error:", error);

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