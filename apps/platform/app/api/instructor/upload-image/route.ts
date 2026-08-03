import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getAuthenticatedConvexClient } from "@/lib/convex";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { requireRoleForApi } from "@/lib/auth-helpers";

const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1 || lastDot === filename.length - 1) return "";
  return filename.slice(lastDot).toLowerCase();
}

function getUploadType(req: NextRequest): "profile" | "portfolio" | null {
  const queryType = req.nextUrl.searchParams.get("type");
  if (queryType === "profile" || queryType === "portfolio") return queryType;
  return null;
}

/**
 * POST /api/instructor/upload-image?type=profile|portfolio
 * Uploads an instructor image to Convex storage and attaches it to the
 * instructor record using the dedicated profile or portfolio mutations.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireRoleForApi("instructor");
    const convex = await getAuthenticatedConvexClient();

    const instructor = await convex.query(api.instructors.getInstructorByUserId, {
      userId: user.id,
    });

    if (!instructor) {
      return NextResponse.json(
        { error: "Instructor profile not found" },
        { status: 404 }
      );
    }

    if (!instructor.slug) {
      return NextResponse.json(
        { error: "Instructor is missing a profile slug" },
        { status: 400 }
      );
    }

    const type = getUploadType(req);
    if (!type) {
      return NextResponse.json(
        { error: "Missing or invalid type. Use ?type=profile or ?type=portfolio" },
        { status: 400 }
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

    const uploadUrl = await convex.mutation(api.instructors.generateAuthenticatedInstructorUploadUrl, {});

    const arrayBuffer = await file.arrayBuffer();
    const uploadResponse = await fetch(uploadUrl, {
      method: "POST",
      body: arrayBuffer,
      headers: { "Content-Type": file.type },
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error("Convex storage upload error:", errorText);
      return NextResponse.json(
        { error: "Failed to upload file to Convex storage", details: errorText },
        { status: 500 }
      );
    }

    const { storageId } = (await uploadResponse.json()) as { storageId: string };
    const url = await convex.query(api.instructors.getStorageUrl, { storageId });
    const resolvedUrl = url ?? `convex://storage/${storageId}`;

    if (type === "profile") {
      await convex.mutation(api.instructors.addInstructorProfileImage, {
        instructorId: instructor._id,
        storageId,
        contentType: file.type,
      });

      const path = `instructors/${instructor.slug}/profile/${storageId}`;
      return NextResponse.json({
        success: true,
        url: resolvedUrl,
        storageId,
        path,
      });
    }

    const portfolioResult = await convex.mutation(api.instructors.addInstructorPortfolioImage, {
      instructorId: instructor._id,
      storageId,
      contentType: file.type,
    });

    const path = `instructors/${instructor.slug}/portfolio/${storageId}`;
    return NextResponse.json({
      success: true,
      url: resolvedUrl,
      storageId,
      path,
      index: portfolioResult.index,
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Instructor role required" }, { status: 403 });
    }

    console.error("Instructor image upload error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 500 }
    );
  }
}
