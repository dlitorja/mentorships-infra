import { NextResponse } from "next/server";
import { requireInstructor, getAccessibleInstructorIds } from "@/lib/auth";
import {
  getInstructorStorageUsage,
  UnauthorizedError,
  ForbiddenError,
} from "@mentorships/db";
import { sql } from "drizzle-orm";
import { instructorUploads } from "@mentorships/db/src/schema";
import { db } from "@mentorships/db";

const STORAGE_LIMIT_BYTES = 20 * 1024 * 1024 * 1024; // 20GB

export async function GET(): Promise<NextResponse> {
  try {
    const dbUser = await requireInstructor();
    const accessibleIds = await getAccessibleInstructorIds();

    let usedBytes = 0;
    let fileCount = 0;

    if (dbUser.role === "admin") {
      const result = await db
        .select({
          totalSize: sql<number>`COALESCE(SUM(${instructorUploads.size}), 0)`,
          fileCount: sql<number>`COUNT(*)`,
        })
        .from(instructorUploads)
        .where(sql`${instructorUploads.status} != 'deleted'`);
      
      usedBytes = Number(result[0]?.totalSize || 0);
      fileCount = Number(result[0]?.fileCount || 0);
    } else if (accessibleIds === null || accessibleIds.length === 0) {
      const usage = await getInstructorStorageUsage(dbUser.id);
      usedBytes = Number(usage.totalSize);
      fileCount = usage.fileCount;
    } else {
      let totalSize = 0;
      let totalCount = 0;

      for (const instructorId of accessibleIds) {
        const usage = await getInstructorStorageUsage(instructorId);
        totalSize += Number(usage.totalSize);
        totalCount += usage.fileCount;
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