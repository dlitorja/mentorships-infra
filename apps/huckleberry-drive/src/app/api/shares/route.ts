import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { canAccessFile, requireInstructor, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import {
  buildShareUrl,
  generateShareToken,
  normalizeExpiresInDays,
} from "@/lib/shares";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireInstructor();
    const { getToken } = await auth();
    const convexToken = await getToken({ template: "convex" }) ?? undefined;

    const body = await request.json();
    const { uploadId, label, expiresInDays } = body;

    if (!uploadId || typeof uploadId !== "string") {
      return NextResponse.json({ error: "uploadId is required" }, { status: 400 });
    }

    if (label !== undefined && (typeof label !== "string" || label.length > 200)) {
      return NextResponse.json({ error: "label must be a string up to 200 chars" }, { status: 400 });
    }

    const { expiresAt: normalizedExpiresAt, error: expiryError } =
      normalizeExpiresInDays(expiresInDays);
    if (expiryError) {
      return NextResponse.json({ error: expiryError }, { status: 400 });
    }

    const upload = await fetchQuery(
      api.instructorUploads.getUploadById,
      { id: uploadId },
      { token: convexToken }
    );
    if (!upload) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    if (upload.status === "deleted") {
      return NextResponse.json({ error: "Cannot share a deleted file" }, { status: 400 });
    }

    const hasAccess = await canAccessFile(upload.instructorId);
    if (!hasAccess) {
      return NextResponse.json({ error: "Not authorized to share this file" }, { status: 403 });
    }

    const token = generateShareToken();

    const result = await fetchMutation(
      api.hdShareLinks.createShareLink,
      {
        uploadLegacyId: uploadId,
        token,
        label: label ?? undefined,
        expiresAt: normalizedExpiresAt,
      },
      { token: convexToken }
    );

    return NextResponse.json(
      {
        shareId: result.shareId,
        token: result.token,
        url: buildShareUrl(result.token),
        expiresAt: normalizedExpiresAt ?? null,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Create share error:", error);

    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(): Promise<NextResponse> {
  try {
    await requireInstructor();
    const { getToken } = await auth();
    const convexToken = await getToken({ template: "convex" }) ?? undefined;

    const result = await fetchQuery(api.hdShareLinks.listMyShareLinks, {}, { token: convexToken });
    return NextResponse.json(result);
  } catch (error) {
    console.error("List shares error:", error);

    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
