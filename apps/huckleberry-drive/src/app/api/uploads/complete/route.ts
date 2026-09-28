import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { requireInstructor, canAccessInstructorData, getAccessibleInstructorIds, getCurrentUser, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { completeMultipartUpload, type UploadPart } from "@mentorships/storage";
import { fetchQuery, fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

interface Upload {
  _id: string;
  instructorId: string;
  uploadedById?: string;
  status?: string;
  b2UploadId?: string;
  createdAt?: number;
}

// Time-bounded grace window during which an uploader can complete an
// in-progress multipart upload after their access has been revoked. Bounds
// the abuse window for revoked-then-finalize while still letting the
// B2 multipart state be cleaned up (rather than orphaned forever). After
// this window, revoked editors must abort and the row stays in
// `uploading` state for admin cleanup.
const OWNER_FINISH_GRACE_MS = 60 * 1000;

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
    // Fallback: if the uploader is the caller and the upload is still in a
    // non-terminal state AND was started within the grace window, allow
    // them to finish an in-progress multipart upload after their access
    // has been revoked. The grace window bounds the abuse path for a
    // revoked-then-finalize race while still letting the B2 multipart
    // state be cleaned up (rather than orphaned forever). After the
    // window expires, revoked editors must abort and the row stays in
    // `uploading` state for admin cleanup.
    //
    // SECURITY: even within the grace window, the original uploader
    // must still have SOME active assignment (open or specific). If
    // every assignment has been revoked, the editor cannot finish even
    // their own upload — they must abort. This closes the round-21
    // Greptile P1: "Revoked access still permits completion". The grace
    // now only handles transient races, not full revocation.
    const inProgressStatuses = new Set(["pending", "uploading"]);
    const isInProgress = upload.status ? inProgressStatuses.has(upload.status) : true;
    const isWithinGraceWindow =
      upload.createdAt !== undefined &&
      Date.now() - upload.createdAt < OWNER_FINISH_GRACE_MS;
    let isOwnerFinishingOwnUpload = false;
    if (
      upload.uploadedById !== undefined &&
      isInProgress &&
      isWithinGraceWindow
    ) {
      const dbUser = await getCurrentUser();
      if (dbUser && upload.uploadedById === dbUser.userId) {
        // Confirm the editor still has SOME access (open or specific)
        // at complete time. If all assignments have been revoked,
        // deny — they must abort instead of finishing an upload they
        // can no longer authorize. `accessible === null` means open
        // access still active (positive); an empty array means all
        // specific assignments removed (negative). We accept either
        // form as "has some access".
        if (dbUser.role === "video_editor") {
          const accessible = await getAccessibleInstructorIds();
          const hasSomeAccess =
            accessible === null || accessible.length > 0;
          if (!hasSomeAccess) {
            return NextResponse.json(
              { error: "All assignments have been revoked — abort the upload" },
              { status: 403 }
            );
          }
        }
        isOwnerFinishingOwnUpload = true;
      }
    }
    if (!hasAccess && !isOwnerFinishingOwnUpload) {
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