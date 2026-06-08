import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { z } from "zod";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";

const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
const MAX_FILE_SIZE = 10 * 1024 * 1024;

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  return new ConvexHttpClient(convexUrl);
}

function getFileExtension(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  return ext || ".jpg";
}

const storageIdSchema = z.object({
  storageId: z.string(),
});

/**
 * POST /api/admin/upload
 * Handles image file uploads to Convex storage.
 * Requires admin role. Accepts JPEG, PNG, WebP, GIF up to 10MB.
 * Validates file type, size, and extension before upload.
 * Returns { success, storageId, url, path } on success.
 */
export async function POST(req: NextRequest) {
  console.log("[upload] Starting upload request");
  try {
    console.log("[upload] Checking auth via requireRoleForApi");
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    const user = await requireRoleForApi("admin");
    console.log("[upload] Auth passed, user:", user?.id);

    console.log("[upload] Creating Convex client");
    const convex = getConvexClient();

    console.log("[upload] Parsing form data");
    const formData = await req.formData();
    const fileRaw = formData.get("file");

    if (!(fileRaw instanceof File)) {
      return NextResponse.json(
        { error: "No file provided or invalid file type" },
        { status: 400 }
      );
    }

    const file: File = fileRaw;
    console.log("[upload] File:", file.name, file.type, file.size);

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

    console.log("[upload] Calling generateInstructorUploadUrl");
    const uploadUrl = await convex.mutation(api.instructors.generateInstructorUploadUrl, {});
    console.log("[upload] Got upload URL:", uploadUrl ? "yes" : "no");

    const arrayBuffer = await file.arrayBuffer();
    console.log("[upload] Uploading to Convex storage");
    const response = await fetch(uploadUrl, {
      method: "POST",
      body: arrayBuffer,
      headers: {
        "Content-Type": file.type,
      },
    });
    console.log("[upload] Storage response:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[upload] Convex storage upload error:", errorText);
      return NextResponse.json(
        { error: "Failed to upload file to Convex storage", details: errorText },
        { status: 500 }
      );
    }

    const parsed = storageIdSchema.safeParse(await response.json());
    if (!parsed.success) {
      console.error("[upload] Invalid storage response");
      return NextResponse.json(
        { error: "Invalid response from Convex storage" },
        { status: 500 }
      );
    }

    const { storageId } = parsed.data;
    console.log("[upload] Got storageId:", storageId);

    console.log("[upload] Getting storage URL");
    const url = await convex.query(api.instructors.getStorageUrl, { storageId });
    console.log("[upload] Got URL:", url ? "yes" : "no");

    if (!url) {
      console.error("[upload] No URL returned from getStorageUrl");
      return NextResponse.json(
        { error: "Failed to get storage URL for uploaded file" },
        { status: 500 }
      );
    }

    console.log("[upload] Success!");
    return NextResponse.json({
      success: true,
      url,
      storageId,
      path: `admin-uploads/${storageId}`,
    });
  } catch (error) {
    console.error("[upload] Full error:", error);
    console.error("[upload] Error constructor:", error?.constructor?.name);
    if (error && typeof error === 'object' && 'cause' in error) {
      console.error("[upload] Error cause:", (error as {cause: unknown}).cause);
    }
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin access required" }, { status: 403 });
    }

    console.error("Upload error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 500 }
    );
  }
}