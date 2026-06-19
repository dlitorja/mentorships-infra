import { NextRequest, NextResponse } from "next/server";
import { requireInstructor, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getB2Client, B2_BUCKET_NAME } from "@mentorships/storage/src/client";

interface User {
  _id: string;
  userId: string;
  role: string;
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

interface BulkDownloadFile {
  fileId: string;
  b2Key: string;
  originalName: string;
  contentType: string;
  size: number;
}

interface Params {
  params: Promise<{ jobId: string }>;
}

async function getJobStatus(jobId: string): Promise<BulkDownloadJob | null> {
  const client = getB2Client();
  const key = `bulk-download-jobs/${jobId}.json`;

  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: B2_BUCKET_NAME,
        Key: key,
      })
    );

    if (!response.Body) return null;

    const chunks: Buffer[] = [];
    const body = response.Body as any;
    for await (const chunk of body) {
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch (error: any) {
    if (error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw error;
  }
}

export async function GET(
  request: NextRequest,
  { params }: Params
): Promise<NextResponse> {
  try {
    const dbUser = await requireInstructor() as User;
    const { jobId } = await params;

    const job = await getJobStatus(jobId);

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.userId !== dbUser.userId && dbUser.role !== "admin") {
      return NextResponse.json({ error: "Not authorized to view this job" }, { status: 403 });
    }

    const response: {
      jobId: string;
      status: string;
      fileCount: number;
      downloadUrl?: string;
      error?: string;
      createdAt: number;
      expiresAt?: number;
    } = {
      jobId: job.jobId,
      status: job.status,
      fileCount: job.files.length,
      createdAt: job.createdAt,
    };

    if (job.status === "completed" && job.downloadUrl) {
      response.downloadUrl = job.downloadUrl;
      response.expiresAt = job.expiresAt;
    }

    if (job.status === "failed" && job.error) {
      response.error = job.error;
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error("Get bulk download status error:", error);

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