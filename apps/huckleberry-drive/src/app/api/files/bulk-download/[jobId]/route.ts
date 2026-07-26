import { NextRequest, NextResponse } from "next/server";
import { requireInstructor, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { getJobStatus } from "@mentorships/storage";

interface User {
  _id: string;
  userId: string;
  role: string;
}

interface Params {
  params: Promise<{ jobId: string }>;
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
      chunkCount: number;
      completedChunks: number;
      downloadUrl?: string;
      downloadUrls?: string[];
      error?: string;
      createdAt: number;
      expiresAt?: number;
      totalBytes?: number;
    } = {
      jobId: job.jobId,
      status: job.status,
      fileCount: job.fileCount ?? 0,
      chunkCount: job.chunkCount,
      completedChunks: job.chunks.filter((c) => c.status === "completed").length,
      createdAt: job.createdAt,
    };

    if (job.status === "completed") {
      if (job.downloadUrl) {
        response.downloadUrl = job.downloadUrl;
      }
      if (job.downloadUrls && job.downloadUrls.length > 0) {
        response.downloadUrls = job.downloadUrls;
      }
      response.expiresAt = job.expiresAt;
      response.totalBytes = job.totalBytes;
      response.fileCount = job.fileCount ?? job.files.length;
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
