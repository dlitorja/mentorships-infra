import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { auth } from "@clerk/nextjs/server";
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

export async function POST(req: NextRequest) {
  try {
    const clerkAuth = await auth();
    const { userId: clerkUserId } = clerkAuth;
    if (!clerkUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const convex = getConvexClient();
    const token = await clerkAuth.getToken({ template: "convex" });
    if (token) {
      convex.setAuth(token);
    }

    const formData = await req.formData();
    const fileRaw = formData.get("file");

    if (!(fileRaw instanceof File)) {
      return NextResponse.json(
        { error: "No file provided or invalid file type" },
        { status: 400 }
      );
    }

    const file: File = fileRaw;

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

    const parsed = storageIdSchema.safeParse(await response.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid response from Convex storage" },
        { status: 500 }
      );
    }

    const { storageId } = parsed.data;

    const url = await convex.query(api.instructors.getStorageUrl, { storageId });

    if (!url) {
      return NextResponse.json(
        { error: "Failed to get storage URL for uploaded file" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      url,
      storageId,
      path: `admin-uploads/${storageId}`,
    });
  } catch (error) {
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