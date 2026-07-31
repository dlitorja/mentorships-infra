import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireDbUser } from "@/lib/auth";
import { getAuthenticatedConvexClient } from "@/lib/convex";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

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

const storageUploadResponseSchema = z.object({
  storageId: z.string(),
});

async function uploadWithTimeout(
  uploadUrl: string,
  mimeType: string,
  bytes: ArrayBuffer,
  timeoutMs: number = 60_000
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": mimeType },
      body: bytes,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
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

    const convex = await getAuthenticatedConvexClient();
    const uploaded: Array<{ path: string; storageId: string; mimeType: string; sizeBytes: number }> = [];

    for (const file of files) {
      const mimeType = file.type;
      const ext = extForMime(mimeType);
      if (!ext) {
        await cleanupUploaded(convex, uploaded);
        return NextResponse.json(
          { error: `Unsupported image type: ${mimeType || "unknown"}`, errorId },
          { status: 400 }
        );
      }

      // 10MB per image (keeps uploads snappy and avoids abuse)
      const maxBytes = 10 * 1024 * 1024;
      if (file.size > maxBytes) {
        await cleanupUploaded(convex, uploaded);
        return NextResponse.json(
          { error: "Each image must be <= 10MB", errorId },
          { status: 400 }
        );
      }

      const objectPath = `onboarding/${user.id}/${submissionId}/${randomUUID()}${ext}`;
      const bytes = new Uint8Array(await file.arrayBuffer());

      const uploadUrl = await convex.action(api.studentOnboarding.generateImageUploadUrl, {});
      const uploadResponse = await uploadWithTimeout(uploadUrl, mimeType, bytes.buffer);

      if (!uploadResponse.ok) {
        await cleanupUploaded(convex, uploaded);
        const text = await uploadResponse.text().catch(() => "Unknown error");
        return NextResponse.json(
          { error: `Upload failed: ${text}`, errorId },
          { status: 500 }
        );
      }

      const parsed = storageUploadResponseSchema.safeParse(await uploadResponse.json());
      if (!parsed.success || !parsed.data.storageId) {
        await cleanupUploaded(convex, uploaded);
        return NextResponse.json(
          { error: "Upload failed: missing or invalid storageId", errorId },
          { status: 500 }
        );
      }

      uploaded.push({ path: objectPath, storageId: parsed.data.storageId, mimeType, sizeBytes: file.size });
    }

    // Record the uploaded storage IDs so the submit route can verify the
    // client has not substituted arbitrary storage IDs.
    const storageIds = uploaded.map((img) => img.storageId as Id<"_storage">);
    await convex.mutation(api.studentOnboarding.recordUpload, {
      legacyId: submissionId,
      storageIds,
    });

    return NextResponse.json({ success: true, submissionId, images: uploaded });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error", errorId },
      { status: 500 }
    );
  }
}

async function cleanupUploaded(
  convex: Awaited<ReturnType<typeof getAuthenticatedConvexClient>>,
  uploaded: Array<{ storageId: string }>
): Promise<void> {
  if (uploaded.length === 0) return;
  const storageIds = uploaded.map((img) => img.storageId as Id<"_storage">);
  await convex.action(api.studentOnboarding.deleteStorageObjects, { storageIds }).catch(() => {
    // Best-effort cleanup; don't hide the original error.
  });
}
