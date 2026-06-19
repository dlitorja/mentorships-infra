import { NextRequest, NextResponse } from "next/server";
import { requireInstructor, canAccessFile, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { tasks } from "@trigger.dev/sdk";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getB2Client, B2_BUCKET_NAME } from "@mentorships/storage/src/client";

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

interface BulkDownloadFile {
  fileId: string;
  b2Key: string;
  originalName: string;
  contentType: string;
  size: number;
}

interface BulkDownloadJob {
  jobId: string;
  userId: string;
  files: BulkDownloadFile[];
  status: "pending" | "processing" | "completed" | "failed";
  downloadUrl?: string;
  error?: string;
  createdAt: number;
  expiresAt?: number;
}

const MAX_FILES_PER_REQUEST = 20;

async function saveJobStatus(job: BulkDownloadJob): Promise<void> {
  const client = getB2Client();
  const key = `bulk-download-jobs/${job.jobId}.json`;

  await client.send(
    new PutObjectCommand({
      Bucket: B2_BUCKET_NAME,
      Key: key,
      Body: JSON.stringify(job),
      ContentType: "application/json",
    })
  );
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

    if (fileIds.length > MAX_FILES_PER_REQUEST) {
      return NextResponse.json(
        { error: `Too many files. Maximum is ${MAX_FILES_PER_REQUEST}` },
        { status: 400 }
      );
    }

    const files: BulkDownloadFile[] = [];

    for (const fileId of fileIds) {
      const upload = await fetchQuery(api.instructorUploads.getUploadById, { id: fileId }) as Upload | null;

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

      const hasAccess = await canAccessFile(upload.instructorId);
      const isUploader = upload.instructorId === dbUser.userId || upload.uploadedById === dbUser.userId;
      const isAdmin = dbUser.role === "admin";

      if (!hasAccess && !isUploader && !isAdmin) {
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
      createdAt: Date.now(),
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