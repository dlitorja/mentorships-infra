import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import { requireDbUser } from "@/lib/auth";
import { createSupabaseAdminClient, ONBOARDING_BUCKET } from "@/lib/supabase-admin";

const uploadSchema = z.object({
  submissionId: z.string().uuid(),
});

type UploadResponse =
  | {
      success: true;
      submissionId: string;
      images: Array<{ path: string; mimeType: string; sizeBytes: number }>;
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

    const form = await request.formData();
    const submissionIdRaw = form.get("submissionId");
    const submissionId = uploadSchema.parse({ submissionId: submissionIdRaw }).submissionId;

    const files = form
      .getAll("files")
      .filter((v): v is File => typeof File !== "undefined" && v instanceof File);

    if (files.length < 1 || files.length > 4) {
      return NextResponse.json(
        { error: "Upload must include 1 to 4 images", errorId },
        { status: 400 }
      );
    }

    const supabase = createSupabaseAdminClient();
    const uploaded: Array<{ path: string; mimeType: string; sizeBytes: number }> = [];

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

      const { error } = await supabase.storage.from(ONBOARDING_BUCKET).upload(objectPath, bytes, {
        contentType: mimeType,
        upsert: false,
      });

      if (error) {
        return NextResponse.json(
          { error: `Upload failed: ${error.message}`, errorId },
          { status: 500 }
        );
      }

      uploaded.push({ path: objectPath, mimeType, sizeBytes: file.size });
    }

    return NextResponse.json({ success: true, submissionId, images: uploaded });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error", errorId },
      { status: 500 }
    );
  }
}


