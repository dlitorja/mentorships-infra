import { NextResponse } from "next/server";
import { requireInstructor, getAccessibleInstructorIds, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

const STORAGE_LIMIT_BYTES = 20 * 1024 * 1024 * 1024; // 20GB

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

async function getUploadsForInstructor(instructorId: string): Promise<Upload[]> {
  return await fetchQuery(api.instructorUploads.getInstructorUploads, { instructorId }) as Upload[];
}

export async function GET(): Promise<NextResponse> {
  try {
    const dbUser = await requireInstructor() as User;
    const accessibleIds = await getAccessibleInstructorIds();

    let usedBytes = 0;
    let fileCount = 0;

    if (dbUser.role === "admin") {
      // For admin, we'd need to get all uploads - not efficient in Convex
      // For now, return 0 as a placeholder until we add proper aggregation
      usedBytes = 0;
      fileCount = 0;
    } else if (accessibleIds === null || accessibleIds.length === 0) {
      const uploads = await getUploadsForInstructor(dbUser.userId);
      const nonDeleted = uploads.filter(u => u.status !== "deleted");
      usedBytes = nonDeleted.reduce((sum, u) => sum + u.size, 0);
      fileCount = nonDeleted.length;
    } else {
      let totalSize = 0;
      let totalCount = 0;

      for (const instructorId of accessibleIds) {
        const uploads = await getUploadsForInstructor(instructorId);
        const nonDeleted = uploads.filter(u => u.status !== "deleted");
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