import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getAuthenticatedConvexClient } from "@/lib/convex";
import { isUnauthorizedError } from "@/lib/errors";

const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Extracts the lower-case file extension from a filename.
 * Returns the real extension when present, otherwise falls back to .jpg
 * so a file with no extension can still be validated by MIME type.
 */
function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1 || lastDot === filename.length - 1) return ".jpg";
  return filename.slice(lastDot).toLowerCase();
}

/**
 * POST /api/instructor/student-results/upload
 * Uploads an image to Convex storage and creates a student result record.
 */
export async function POST(req: NextRequest) {
  try {
    const { requireDbUser } = await import("@/lib/auth");
    const user = await requireDbUser();

    const convex = await getAuthenticatedConvexClient();

    const instructor = await convex.query(api.instructors.getInstructorByUserIdExternal, {
      userId: user.id,
    });

    if (!instructor) {
      return NextResponse.json(
        { error: "Instructor profile not found" },
        { status: 404 }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Allowed: jpg, png, webp, gif" },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 10MB" },
        { status: 400 }
      );
    }

    const fileExtension = getFileExtension(file.name);
    if (!ALLOWED_EXTENSIONS.includes(fileExtension)) {
      return NextResponse.json(
        { error: "Invalid file extension" },
        { status: 400 }
      );
    }

    const uploadUrl = await convex.mutation(api.instructors.generateInstructorUploadUrl, {});

    const arrayBuffer = await file.arrayBuffer();
    const response = await fetch(uploadUrl, {
      method: "POST",
      body: arrayBuffer,
      headers: {
        "Content-Type": file.type,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Convex storage upload error:", errorText);
      return NextResponse.json(
        { error: "Failed to upload file to Convex storage", details: errorText },
        { status: 500 }
      );
    }

    const { storageId } = await response.json() as { storageId: string };

    const url = await convex.query(api.instructors.getStorageUrl, { storageId });

    const studentResultId = await convex.mutation(api.instructors.createStudentResultWithStorage, {
      instructorId: instructor._id,
      imageUrl: url ?? `convex://storage/${storageId}`,
      imageStorageId: storageId,
      studentName: "",
      createdBy: user.id,
    });

    return NextResponse.json({
      success: true,
      url: url ?? `convex://storage/${storageId}`,
      storageId,
      path: `instructors/${instructor.slug}/results/${storageId}`,
      studentResultId,
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("Upload error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 500 }
    );
  }
}