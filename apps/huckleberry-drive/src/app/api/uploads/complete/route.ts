import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { requireInstructor, canAccessInstructorData, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { completeMultipartUpload, type UploadPart } from "@mentorships/storage";
import { fetchQuery, fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

interface Upload {
  _id: string;
  instructorId: string;
  b2UploadId?: string;
}

function getStringProperty(error: unknown, key: string): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const value = Reflect.get(error, key);
  return typeof value === "string" ? value : undefined;
}

function getMetadataRequestId(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const metadata = Reflect.get(error, "$metadata");
  if (typeof metadata !== "object" || metadata === null) return undefined;
  const requestId = Reflect.get(metadata, "requestId");
  return typeof requestId === "string" ? requestId : undefined;
}

const completeSchema = z.object({
  fileId: z.string(),
  uploadId: z.string(),
  key: z.string(),
  parts: z.array(
    z.object({
      partNumber: z.number().int().positive(),
      etag: z.string().min(1).optional(),
    })
  ),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireInstructor();
    const { getToken } = await auth();
    const convexToken = await getToken({ template: "convex" }) ?? undefined;
    const body = await request.json();

    const parsed = completeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { fileId, uploadId, key, parts } = parsed.data;

    const upload = await fetchQuery(api.instructorUploads.getUploadById, { id: fileId }, { token: convexToken }) as Upload | null;
    if (!upload) {
      return NextResponse.json({ error: "Upload not found" }, { status: 404 });
    }

    const hasAccess = await canAccessInstructorData(upload.instructorId);
    if (!hasAccess) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    if (upload.b2UploadId !== uploadId) {
      return NextResponse.json({ error: "Invalid upload ID" }, { status: 400 });
    }

    console.log("completeMultipartUpload called with:", {
      key,
      uploadId,
      parts: parts.map(p => ({
        partNumber: p.partNumber,
        etag: p.etag ? `${p.etag.substring(0, 20)} (${p.etag.length} chars)` : "<missing, will use B2 list>",
      }))
    });

    let result;
    try {
      result = await completeMultipartUpload({
        key,
        uploadId,
        parts: parts as UploadPart[],
      });
    } catch (error) {
      console.error("completeMultipartUpload failed:", {
        key,
        uploadId,
        partsCount: parts.length,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    await fetchMutation(api.instructorUploads.completeUpload, {
      id: fileId,
      // PR1: guard against B2 returning neither a versionId nor an
      // etag. Previously `result.etag.replace(...)` would crash the
      // mutation when etag was undefined; falling back to the key
      // gives a usable (if non-unique) identifier for storage
      // accounting. The soft-delete path can still match by legacyId.
      b2FileId: result.versionId || result.etag?.replace(/"/g, "") || `b2-key:${key}`,
    }, { token: convexToken });

    return NextResponse.json({
      success: true,
      fileId,
      etag: result.etag,
      versionId: result.versionId,
      location: result.location,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }

    console.error("Upload complete error:", error);

    if (error instanceof Error) {
      const code = getStringProperty(error, "code");
      const requestId = getMetadataRequestId(error);
      const name = getStringProperty(error, "name");
      console.error("Upload complete diagnostics:", { code, requestId, name });

      // S3/B2 client errors (4xx style) and the storage package's plain
      // validation failures are user-facing; everything else (5xx, runtime
      // failures) is a server issue with a generic response.
      if (
        (code &&
          new Set([
            "EntityTooSmall",
            "EntityTooLarge",
            "InvalidArgument",
            "InvalidDigest",
            "InvalidPart",
            "InvalidPartOrder",
            "MalformedXML",
            "MethodNotAllowed",
            "NotImplemented",
            "RequestNotSupported",
          ]).has(code)) ||
        error.message.includes("was not found in B2's ListParts response")
      ) {
        return NextResponse.json({ error: error.message, ...(code ? { code } : {}) }, { status: 400 });
      }
      return NextResponse.json({ error: "Upload completion failed" }, { status: 500 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}