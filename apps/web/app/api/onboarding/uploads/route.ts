import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireDbUser } from "@/lib/auth";
import { getConvexClient } from "@/lib/convex";
import { api } from "@/convex/_generated/api";

type UploadResponse =
  | {
      success: true;
      submissionId: string;
      images: Array<{
        path: string;
        storageId: string;
        mimeType: string;
        sizeBytes: number;
      }>;
    }
  | { error: string; errorId: string };

function extForMime(mimeType: string): string | null {
  switch (mimeType) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    default:
      return null;
  }
}

export async function POST(request: Request): Promise<NextResponse<UploadResponse>> {
  const errorId = randomUUID();
  try {
    const user = await requireDbUser();

    // Generate submissionId server-side to prevent race conditions and client manipulation
    const submissionId = randomUUID();

    const form = await request.formData();
    const files = form
      .getAll("files")
      .filter((v): v is File => typeof File !== "undefined" && v instanceof File);

    // Align validation with submit route: require 2-4 images
    if (files.length < 2 || files.length > 4) {
      return NextResponse.json(
        { error: "Upload must include 2 to 4 images", errorId },
        { status: 400 }
      );
    }

    const convex = getConvexClient();
    const uploaded: Array<{ path: string; storageId: string; mimeType: string; sizeBytes: number }> = [];

    for (const file of files) {
      const mimeType = file.type;
      const ext = extForMime(mimeType);
      if (!ext) {
        return NextResponse.json(
          { error: `Unsupported image type: ${mimeType || "unknown"}`, errorId },
          { status: 400 }
        );
      }

      // 10MB per image (keeps uploads snappy and avoids abuse)
      const maxBytes = 10 * 1024 * 1024;
      if (file.size > maxBytes) {
        return NextResponse.json(
          { error: "Each image must be <= 10MB", errorId },
          { status: 400 }
        );
      }

      const objectPath = `onboarding/${user.id}/${submissionId}/${randomUUID()}${ext}`;
      const bytes = new Uint8Array(await file.arrayBuffer());

      const uploadUrl = await convex.action(api.studentOnboarding.generateImageUploadUrl, {});
      const uploadResponse = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": mimeType },
        body: bytes,
      });

      if (!uploadResponse.ok) {
        const text = await uploadResponse.text().catch(() => "Unknown error");
        return NextResponse.json(
          { error: `Upload failed: ${text}`, errorId },
          { status: 500 }
        );
      }

      const { storageId } = (await uploadResponse.json()) as { storageId: string };
      if (!storageId) {
        return NextResponse.json(
          { error: "Upload failed: missing storageId", errorId },
          { status: 500 }
        );
      }

      uploaded.push({ path: objectPath, storageId, mimeType, sizeBytes: file.size });
    }

    // Note: We don't create the submission record here because mentorId and sessionPackId
    // are required. The submissionId is generated server-side to prevent client manipulation
    // and race conditions; the submit route verifies the returned storageIds belong to
    // this submission.

    return NextResponse.json({ success: true, submissionId, images: uploaded });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error", errorId },
      { status: 500 }
    );
  }
}


