import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireInstructor, getAccessibleInstructorIds, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { tasks } from "@trigger.dev/sdk";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { BULK_DOWNLOAD_HARD_LIMIT } from "@/lib/api";
import {
  BULK_DOWNLOAD_JOB_EXPIRY_HOURS,
  saveJobStatus,
  type BulkDownloadFile,
  type BulkDownloadJob,
} from "@mentorships/storage";

interface Upload {
  _id: string;
  instructorId: string;
  uploadedById?: string;
  filename: string;
  originalName: string;
  contentType: string;
  size: number;
  status: string;
}

interface User {
  _id: string;
  userId: string;
  role: string;
}

// Cache of active instructor IDs for the lifetime of a single open-
// access authorization check. Avoids a per-file fetch when the bulk
// download contains many files.
async function loadActiveInstructorIds(): Promise<Set<string>> {
  const { getToken } = await auth();
  const token = await getToken({ template: "convex" }) ?? undefined;
  const activeInstructors = await fetchQuery(
    api.users.getActiveUsersByRole,
    { role: "instructor" },
    { token }
  ) as Array<{ userId: string }>;
  return new Set(activeInstructors.map((u) => u.userId));
}

function canAccessUpload(
  upload: Upload,
  dbUser: User,
  accessibleInstructorIds: string[] | null,
  activeInstructorIds?: Set<string>
): boolean {
  if (dbUser.role === "admin") return true;
  if (upload.uploadedById === dbUser.userId) return true;
  if (upload.instructorId === dbUser.userId) return true;
  if (dbUser.role === "video_editor") {
    if (accessibleInstructorIds !== null) {
      return accessibleInstructorIds.includes(upload.instructorId);
    }
    // Open access: only ACTIVE instructors' files are reachable.
    // Without this narrowing, an open-access editor could supply a
    // file ID belonging to a soft-deleted or role-removed instructor
    // and download its B2 object. Mirrors the check in /api/files.
    return activeInstructorIds?.has(upload.instructorId) ?? false;
  }
  return false;
}

export async function POST(
  request: NextRequest
): Promise<NextResponse> {
  try {
    const dbUser = await requireInstructor() as User;
    const body = await request.json();

    const { fileIds } = body as { fileIds: string[] };

    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      return NextResponse.json({ error: "fileIds must be a non-empty array" }, { status: 400 });
    }

    if (fileIds.length > BULK_DOWNLOAD_HARD_LIMIT) {
      return NextResponse.json(
        { error: `Too many files selected. Maximum is ${BULK_DOWNLOAD_HARD_LIMIT}` },
        { status: 400 }
      );
    }

    const accessibleInstructorIds = await getAccessibleInstructorIds();

    const uploads = await fetchQuery(
      api.instructorUploads.getUploadsByIds,
      { ids: fileIds }
    ) as Upload[];

    const uploadById = new Map(uploads.map((u) => [u._id, u]));

    // Resolve the active-instructor set once for open-access checks.
    // If the editor has no active assignments at all, the set is empty
    // and canAccessUpload will reject every file.
    const activeInstructorIds =
      dbUser.role === "video_editor" && accessibleInstructorIds === null
        ? await loadActiveInstructorIds()
        : undefined;

    const files: BulkDownloadFile[] = [];

    for (const fileId of fileIds) {
      const upload = uploadById.get(fileId);

      if (!upload) {
        return NextResponse.json({ error: `File not found: ${fileId}` }, { status: 404 });
      }

      if (upload.status === "deleted" || upload.status === "archived") {
        return NextResponse.json(
          { error: `File is not available for download: ${fileId} (status: ${upload.status})` },
          { status: 400 }
        );
      }

      if (upload.status !== "completed") {
        return NextResponse.json(
          { error: `File is not ready: ${fileId} (status: ${upload.status})` },
          { status: 400 }
        );
      }

      if (!canAccessUpload(upload, dbUser, accessibleInstructorIds, activeInstructorIds)) {
        return NextResponse.json(
          { error: "Not authorized to download this file" },
          { status: 403 }
        );
      }

      if (!upload.filename) {
        return NextResponse.json(
          { error: `File location unknown: ${fileId}` },
          { status: 400 }
        );
      }

      files.push({
        fileId,
        b2Key: upload.filename,
        originalName: upload.originalName,
        contentType: upload.contentType,
        size: upload.size,
      });
    }

    const jobId = crypto.randomUUID();

    const job: BulkDownloadJob = {
      jobId,
      userId: dbUser.userId,
      files,
      status: "pending",
      chunkCount: 0,
      chunks: [],
      createdAt: Date.now(),
      expiresAt: Date.now() + BULK_DOWNLOAD_JOB_EXPIRY_HOURS * 60 * 60 * 1000,
    };

    await saveJobStatus(job);

    try {
      await tasks.trigger("process-bulk-download", {
        jobId,
        files,
        userId: dbUser.userId,
      });
    } catch (taskError) {
      console.error("Failed to trigger bulk download task:", taskError);
      job.status = "failed";
      job.error = "Failed to start download job";
      await saveJobStatus(job);
      return NextResponse.json({ error: "Failed to start download job" }, { status: 500 });
    }

    return NextResponse.json({ jobId });
  } catch (error) {
    console.error("Bulk download error:", error);

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
