import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { Id } from "@/convex/_generated/dataModel";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";

const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

type UploadType = "profile" | "portfolio" | "result";

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  return new ConvexHttpClient(convexUrl);
}

const MIME_TO_EXTENSION: Record<(typeof ALLOWED_TYPES)[number], string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

/**
 * Returns the file's extension (including leading dot) or "" if it cannot be
 * determined. When the filename has no usable extension, fall back to the
 * MIME-derived extension so compressed blobs (which arrive with filename
 * "blob" or empty via FormData) can still be validated.
 */
export function getFileExtension(filename: string, mimeType?: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot !== -1 && lastDot !== filename.length - 1) {
    return filename.slice(lastDot).toLowerCase();
  }
  if (mimeType && (ALLOWED_TYPES as readonly string[]).includes(mimeType)) {
    return MIME_TO_EXTENSION[mimeType as (typeof ALLOWED_TYPES)[number]];
  }
  return "";
}

export async function POST(req: NextRequest) {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const instructorId = formData.get("instructorId") as string | null;
    const type = formData.get("type") as UploadType | null;

    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    if (!instructorId) {
      return NextResponse.json(
        { error: "Instructor ID is required" },
        { status: 400 }
      );
    }

    if (!type || !["profile", "portfolio", "result"].includes(type)) {
      return NextResponse.json(
        { error: "Invalid upload type. Must be: profile, portfolio, or result" },
        { status: 400 }
      );
    }

    if (!(ALLOWED_TYPES as readonly string[]).includes(file.type)) {
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

    const fileExtension = getFileExtension(file.name, file.type);
    if (!ALLOWED_EXTENSIONS.includes(fileExtension)) {
      return NextResponse.json(
        { error: "Invalid file extension" },
        { status: 400 }
      );
    }

    const convex = getConvexClient();

    const instructor = await convex.query(api.instructors.getInstructorById, {
      id: instructorId as Id<"instructors">,
    });

    if (!instructor) {
      return NextResponse.json(
        { error: "Instructor not found" },
        { status: 404 }
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

    if (type === "result") {
      return NextResponse.json({
        success: true,
        url: url ?? `convex://storage/${storageId}`,
        storageId,
        path: `instructors/${instructor.slug}/results/${storageId}`,
      });
    }

    if (type === "profile") {
      // PR 1: updateInstructorProfileStorageId is now atomic — both tables
      // are updated in one transaction.
      await convex.mutation(api.instructors.updateInstructorProfileStorageId, {
        instructorId: instructorId as Id<"instructors">,
        storageId,
        url: url ?? `convex://storage/${storageId}`,
      });
    } else if (type === "portfolio") {
      const currentStorageIds = instructor.portfolioImageStorageIds ?? [];
      const currentUrls = instructor.portfolioImages ?? [];
      // PR 1: updateInstructorPortfolioStorageIds is now atomic — both tables
      // are updated in one transaction.
      await convex.mutation(api.instructors.updateInstructorPortfolioStorageIds, {
        instructorId: instructorId as Id<"instructors">,
        storageIds: [...currentStorageIds, storageId],
        urls: [...currentUrls, url ?? `convex://storage/${storageId}`],
      });
    }

    return NextResponse.json({
      success: true,
      url: url ?? `convex://storage/${storageId}`,
      storageId,
      path: `instructors/${instructor.slug}/${type}/${storageId}`,
    });
  } catch (error) {
    // Map known authorization errors to proper status codes. Convex may throw
    // plain Error("Forbidden"/"Unauthorized") strings; include message checks.
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }
    if (error instanceof Error) {
      const msg = (error.message || "").toLowerCase();
      if (msg.includes("unauthorized")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (msg.includes("forbidden")) {
        return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
      }
    }

    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "Upload failed" },
      { status: 500 }
    );
  }
}
