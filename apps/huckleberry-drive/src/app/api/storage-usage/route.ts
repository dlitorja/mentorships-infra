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

      // For admin, we'd need to get all uploads - not efficient in Convex
      // For now, return 0 as a placeholder until we add proper aggregation
      usedBytes = 0;
      fileCount = 0;
    } else if (accessibleIds === null || accessibleIds.length === 0) {
      const uploads = await getUploadsForInstructor(dbUser.userId);
      const nonDeleted = uploads.filter(u => u.status !== "deleted");
      usedBytes = nonDeleted.reduce((sum, u) => sum + u.size, 0);
      fileCount = nonDeleted.length;

        const uploads = await getUploadsForInstructor(instructorId);
        const nonDeleted = uploads.filter(u => u.status !== "deleted");
        totalSize += nonDeleted.reduce((sum, u) => sum + u.size, 0);
        totalCount += nonDeleted.length;
