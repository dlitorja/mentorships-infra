import { NextRequest, NextResponse } from "next/server";
import { requireInstructor, getAccessibleInstructorIds, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

interface Upload {
  _id: string;
  legacyId?: string;
  instructorId: string;
  uploadedById?: string;
  filename: string;
  originalName: string;
  contentType: string;
  size: number;
  status: string;
  transferStatus?: string;
  s3Key?: string;
  s3Url?: string;
  createdAt?: number;
  archivedAt?: number;
  errorMessage?: string;
  deletedAt?: number;
}

interface User {
  _id: string;
  userId: string;
  role: string;
}

interface FileResponse {
  id: string;
  originalName: string;
  contentType: string;
  size: number;
  status: string;
  transferStatus: string | null;
  createdAt: Date;
  archivedAt: Date | null;
  errorMessage: string | null;
  instructorId?: string;
  uploadedById?: string;
  deletedAt?: number | null;
}

interface PaginationInfo {
  cursor: number | null;
  hasMore: boolean;
}

function formatFileResponse(upload: Upload, includeDeleted = false): FileResponse {
  const base = {
    id: upload.legacyId ?? upload._id,
    originalName: upload.originalName,
    contentType: upload.contentType,
    size: upload.size,
    status: upload.status,
    transferStatus: upload.transferStatus ?? null,
    createdAt: new Date(upload.createdAt ?? 0),
    archivedAt: upload.archivedAt ? new Date(upload.archivedAt) : null,
    errorMessage: upload.errorMessage ?? null,
    instructorId: upload.instructorId,
    uploadedById: upload.uploadedById,
  };

  if (includeDeleted) {
    return { ...base, deletedAt: upload.deletedAt ?? null };
  }

  return base;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const dbUser = await requireInstructor() as User;

    const instructorId = searchParams.get("instructorId") ?? undefined;
    const uploadedById = searchParams.get("uploadedById") ?? undefined;
    const status = searchParams.get("status") ?? undefined;
    const search = searchParams.get("search") ?? undefined;
    const cursor = searchParams.get("cursor") ? Number(searchParams.get("cursor")) : undefined;
    const limit = searchParams.get("limit") ? Math.min(Number(searchParams.get("limit")), 100) : 50;

    let result: { uploads: Upload[]; nextCursor: number | null; hasMore: boolean };

    if (dbUser.role === "admin") {
      result = await fetchQuery(api.instructorUploads.getAllUploads, {
        instructorId: instructorId || undefined,
        uploadedById: uploadedById || undefined,
        status: status || undefined,
        search: search || undefined,
        cursor,
        limit,
      }) as { uploads: Upload[]; nextCursor: number | null; hasMore: boolean };
    } else if (dbUser.role === "instructor") {
      result = await fetchQuery(api.instructorUploads.getAllUploads, {
        instructorId: dbUser.userId,
        status: status === "all" ? undefined : status ?? "completed",
        search: search || undefined,
        cursor,
        limit,
      }) as { uploads: Upload[]; nextCursor: number | null; hasMore: boolean };
    } else {
      if (instructorId) {
        const accessibleIds = await getAccessibleInstructorIds();
        if (!accessibleIds || !accessibleIds.includes(instructorId)) {
          return NextResponse.json({ error: "Not authorized to access this instructor's files" }, { status: 403 });
        }
        result = await fetchQuery(api.instructorUploads.getAllUploads, {
          instructorId,
          status: status === "all" ? undefined : status ?? "completed",
          search: search || undefined,
          cursor,
          limit,
        }) as { uploads: Upload[]; nextCursor: number | null; hasMore: boolean };
      } else {
        result = await fetchQuery(api.instructorUploads.getAllUploads, {
          uploadedById: dbUser.userId,
          status: status === "all" ? undefined : status ?? "completed",
          search: search || undefined,
          cursor,
          limit,
        }) as { uploads: Upload[]; nextCursor: number | null; hasMore: boolean };
      }
    }

    const includeDeleted = status === "all" || status === "deleted";
    const files = result.uploads.map((u) => formatFileResponse(u, includeDeleted));

    const pagination: PaginationInfo = {
      cursor: result.nextCursor,
      hasMore: result.hasMore,
    };

    return NextResponse.json({ files, pagination });
  } catch (error) {
    console.error("List files error:", error);

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