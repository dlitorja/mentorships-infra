import { NextResponse } from "next/server";
import { requireMentor, getAccessibleInstructorIds } from "@/lib/auth";
import {
  getInstructorUploads,
  getUploadsForInstructors,
  getAllInstructorUploads,
  type InstructorUpload,
} from "@mentorships/db";
import { eq } from "drizzle-orm";
import { instructorUploads } from "@mentorships/db";

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
}

function formatFileResponse(upload: InstructorUpload): FileResponse {
  return {
    id: upload.id,
    originalName: upload.originalName,
    contentType: upload.contentType,
    size: upload.size,
    status: upload.status,
    transferStatus: upload.transferStatus,
    createdAt: upload.createdAt,
    archivedAt: upload.archivedAt,
    errorMessage: upload.errorMessage,
  };
}

export async function GET(): Promise<NextResponse> {
  try {
    const dbUser = await requireMentor();
    const accessibleIds = await getAccessibleInstructorIds();
    
    let uploads: InstructorUpload[];
    
    if (dbUser.role === "admin") {
      uploads = await getAllInstructorUploads();
    } else if (accessibleIds === null || accessibleIds.length === 0) {
      uploads = await getInstructorUploads(dbUser.id);
    } else {
      uploads = await getUploadsForInstructors(accessibleIds);
    }
    
    const files = uploads
      .filter((u) => u.status !== "deleted")
      .map(formatFileResponse);
    
    return NextResponse.json({
      files,
      pagination: {
        total: files.length,
        hasMore: false,
      },
    });
  } catch (error) {
    console.error("List files error:", error);
    
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
