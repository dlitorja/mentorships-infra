import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { Id } from "@/convex/_generated/dataModel";
import { isUnauthorizedError, isForbiddenError } from "@mentorships/db";

const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

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

function getFileExtension(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  return ext || ".jpg";
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

    if (type === "result") {
      return NextResponse.json({
        success: true,
        url: url ?? `convex://storage/${storageId}`,
        storageId,
        path: `instructors/${instructor.slug}/results/${storageId}`,
      });
    }

    if (type === "profile") {
      await convex.mutation(api.instructors.updateInstructorProfileStorageId, {
        instructorId: instructorId as Id<"instructors">,
        storageId,
        url: url ?? `convex://storage/${storageId}`,
      });
      if (instructor.slug) {
        try {
          await convex.mutation(api.instructors.updateInstructorProfileStorageIdForProfile, {
            slug: instructor.slug,
            storageId,
            url: url ?? `convex://storage/${storageId}`,
          });
        } catch (e) {
          console.warn(`Failed to update instructorProfiles for slug ${instructor.slug}:`, e);
        }
      }
    } else if (type === "portfolio") {
      const currentStorageIds = instructor.portfolioImageStorageIds ?? [];
      const currentUrls = instructor.portfolioImages ?? [];
      await convex.mutation(api.instructors.updateInstructorPortfolioStorageIds, {
        instructorId: instructorId as Id<"instructors">,
        storageIds: [...currentStorageIds, storageId],
        urls: [...currentUrls, url ?? `convex://storage/${storageId}`],
      });
      if (instructor.slug) {
        try {
          const profile = await convex.query(api.instructors.getInstructorBySlug, { slug: instructor.slug });
          if (profile) {
            const profileStorageIds = profile.portfolioImageStorageIds ?? [];
            const profileUrls = profile.portfolioImages ?? [];
            await convex.mutation(api.instructors.updateInstructorPortfolioStorageIdsForProfile, {
              slug: instructor.slug,
              storageIds: [...profileStorageIds, storageId],
              urls: [...profileUrls, url ?? `convex://storage/${storageId}`],
            });
          }
        } catch (e) {
          console.warn(`Failed to update instructorProfiles for slug ${instructor.slug}:`, e);
        }
      }
    }

    return NextResponse.json({
      success: true,
      url: url ?? `convex://storage/${storageId}`,
      storageId,
      path: `instructors/${instructor.slug}/${type}/${storageId}`,
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }

    console.error("Upload error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 500 }
    );
  }
}