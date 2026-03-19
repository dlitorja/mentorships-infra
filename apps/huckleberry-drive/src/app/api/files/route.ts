import { NextResponse } from "next/server";
import { requireMentor, getAccessibleInstructorIds } from "@/lib/auth";
import { getInstructorUploads, getUploadsForInstructors, type InstructorUpload } from "@mentorships/db";
import { extractFilenameFromKey, extractDateFromKey } from "@mentorships/storage";

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
    
    if (accessibleIds === null) {
      uploads = await getInstructorUploads(dbUser.id);
    } else if (accessibleIds.length === 0) {
      return NextResponse.json({ files: [], pagination: { total: 0, hasMore: false } });
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
