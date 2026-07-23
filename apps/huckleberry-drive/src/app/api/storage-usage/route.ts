import { NextResponse } from "next/server";
import { requireInstructor, getAccessibleInstructorIds, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { STORAGE_LIMIT_BYTES } from "@/lib/limits";

interface Upload {
  _id: string;
  instructorId: string;
  filename: string;
  size: number;
  status: string;
}

interface User {
  _id: string;
  userId: string;
  role: string;
}

interface StorageStats {
  totalFiles: number;
  totalBytes: number;
  activeFiles: number;
  activeBytes: number;
  instructorCount: number;
}

async function getUploadsForInstructor(instructorId: string): Promise<Upload[]> {
  return await fetchQuery(api.instructorUploads.getInstructorUploads, { instructorId }) as Upload[];
}

export async function GET(): Promise<NextResponse> {
  try {
    const dbUser = await requireInstructor() as User;
    const accessibleIds = await getAccessibleInstructorIds();

    if (dbUser.role === "admin") {
      const stats = await fetchQuery(api.instructorUploads.getTotalStorageStats, {}) as StorageStats;

      return NextResponse.json({
        usedBytes: stats.activeBytes,
        limitBytes: null,
        fileCount: stats.activeFiles,
        instructorCount: stats.instructorCount,
      });
    }

    let usedBytes = 0;
    let fileCount = 0;

    if (accessibleIds === null || accessibleIds.length === 0) {
      const uploads = await getUploadsForInstructor(dbUser.userId);
      const nonDeleted = uploads.filter((u) => u.status !== "deleted");
      usedBytes = nonDeleted.reduce((sum, u) => sum + u.size, 0);
      fileCount = nonDeleted.length;
    } else {
      let totalSize = 0;
      let totalCount = 0;

      for (const instructorId of accessibleIds) {
        const uploads = await getUploadsForInstructor(instructorId);
        const nonDeleted = uploads.filter((u) => u.status !== "deleted");
        totalSize += nonDeleted.reduce((sum, u) => sum + u.size, 0);
        totalCount += nonDeleted.length;
      }

      usedBytes = totalSize;
      fileCount = totalCount;
    }

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