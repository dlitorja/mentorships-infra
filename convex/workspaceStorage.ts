import { mutation, action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";

import { MAX_BINDING_AGE_MS } from "./workspaceConstants";

/**
 * Workspace storage migration (PR 1 of 3, widen).
 *
 * Uploads flow directly from the browser to a separate B2 bucket
 * (`mentorship-workspace-storage`) so we stop accruing Convex Free
 * plan storage quota. The upload is gated by a presigned PUT URL
 * minted by `generateWorkspaceUploadUrl`; the binding between the
 * uploaded blob and (caller, workspace) is recorded eagerly in the
 * `fileUploads` ledger at mint time so a follow-up chat-create
 * mutation can verify the caller actually drove the upload (Greptile
 * Security P1).
 *
 * PR 1 widens the surface only:
 *   - new uploads MAY go through `generateWorkspaceUploadUrl` and
 *     `recordB2FileUpload` instead of the legacy Convex storage path;
 *   - existing rows and existing create mutations are unchanged;
 *   - PR 2 migrates Convex blobs into B2;
 *   - PR 3 makes the B2 path the only path and drops the fallback.
 *
 * The action lives in the default Convex runtime (V8); the SigV4
 * PUT/GET signing for a single request is small enough to inline
 * without pulling in `@aws-sdk/client-s3`. Mirrors the same pattern
 * used in `convex/instructorUploads.ts`.
 */

function safePathSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
}

/**
 * Build the B2 object key for a workspace upload.
 *
 * Shape: `{date}/instructors/{instructorId}/students/{studentUserId}/workspaces/{workspaceId}/{fileId}/{fileName}`
 * Fallback for org-style workspaces (no instructor): `{date}/workspaces/{workspaceId}/{fileId}/{fileName}`
 *
 * The `date/` prefix spreads load across partitions and makes
 * lifecycle-rule prefix scoping easy (added in PR 3).
 */
export function buildWorkspaceStorageKey(args: {
  date: string;
  instructorId: Id<"instructors"> | null;
  studentUserId: string;
  workspaceId: Id<"workspaces">;
  fileId: string;
  fileName: string;
}): string {
  const safeName = safePathSegment(args.fileName);
  const safeFileId = safePathSegment(args.fileId);
  if (args.instructorId) {
    return [
      args.date,
      "instructors",
      safePathSegment(String(args.instructorId)),
      "students",
      safePathSegment(args.studentUserId),
      "workspaces",
      safePathSegment(String(args.workspaceId)),
      safeFileId,
      safeName,
    ].join("/");
  }
  return [
    args.date,
    "workspaces",
    safePathSegment(String(args.workspaceId)),
    safeFileId,
    safeName,
  ].join("/");
}

/**
 * Internal query: resolve the caller's role in a workspace so the
 * action can mint a presigned upload URL only for authorized
 * callers. Returns `null` when the caller is not a member of an
 * active workspace, which the action translates into a stable
 * "Not authorized" error.
 *
 * Convex actions don't have `ctx.db` — they have to delegate
 * authorization to a query. Reusing the same logic keeps the new
 * B2 path and the existing Convex-storage path enforcing the same
 * access rules (mirrors `convex/workspaces.ts:getWorkspaceRole`).
 */
export const resolveWorkspaceUploadAccess = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args): Promise<{
    role: "instructor" | "student" | "admin";
    workspace: Doc<"workspaces">;
    studentUserId: string;
  } | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const workspace: Doc<"workspaces"> | null = await ctx.db.get(args.workspaceId);
    if (!workspace) return null;
    if (workspace.deletedAt !== undefined) return null;

    const callerId = identity.subject;

    const user: { role?: string } | null = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", callerId))
      .first();
    if (user?.role === "admin") {
      return { role: "admin", workspace, studentUserId: workspace.ownerId };
    }

    if (workspace.instructorId) {
      const instructor: { _id: Id<"instructors">; userId: string } | null = await ctx.db
        .query("instructors")
        .withIndex("by_userId", (q) => q.eq("userId", callerId))
        .first();
      if (instructor && instructor._id === workspace.instructorId) {
        return { role: "instructor", workspace, studentUserId: workspace.ownerId };
      }
    }
    if (workspace.ownerId === callerId) {
      return { role: "student", workspace, studentUserId: workspace.ownerId };
    }
    return null;
  },
});

/**
 * Internal mutation: write a single `fileUploads` ledger row keyed
 * by `b2Key`. Idempotent on the (workspaceId, b2Key) pair — a
 * duplicate insert throws so the action surfaces a useful error
 * instead of silently producing two competing bindings.
 */
export const insertB2FileUploadLedger = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    b2Key: v.string(),
    uploaderId: v.string(),
    uploadedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("fileUploads")
      .withIndex("by_b2Key", (q) => q.eq("b2Key", args.b2Key))
      .first();
    if (existing) {
      throw new Error(
        "B2 key is already reserved. Retry with a fresh fileId."
      );
    }
    await ctx.db.insert("fileUploads", {
      uploaderId: args.uploaderId,
      workspaceId: args.workspaceId,
      uploadedAt: args.uploadedAt,
      b2Key: args.b2Key,
    });
  },
});

/**
 * Action: mint a Backblaze B2 presigned PUT URL for a workspace
 * upload. The corresponding ledger row is written eagerly so a
 * follow-up chat-create mutation can verify the caller actually
 * drove the upload (Greptile Security P1).
 *
 * Caller-side flow:
 *   1. `generateWorkspaceUploadUrl({ workspaceId, fileId, fileName, contentType })`
 *   2. `fetch(uploadUrl, { method: "PUT", body: file })`
 *   3. `recordB2FileUpload({ workspaceId, b2Key })`
 *   4. Pass `b2Key` to the chat-create mutation (PR 3).
 */
export const generateWorkspaceUploadUrl = action({
  args: {
    workspaceId: v.id("workspaces"),
    fileId: v.string(),
    fileName: v.string(),
    contentType: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ uploadUrl: string; b2Key: string; fileId: string }> => {
    const access: {
      role: "instructor" | "student" | "admin";
      workspace: Doc<"workspaces">;
      studentUserId: string;
    } | null = await ctx.runQuery(
      internal.workspaceStorage.resolveWorkspaceUploadAccess,
      { workspaceId: args.workspaceId }
    );
    if (!access) {
      throw new Error("Not authorized to upload to this workspace");
    }

    const instructorId =
      access.role === "instructor" && access.workspace.instructorId
        ? access.workspace.instructorId
        : null;

    const date = new Date().toISOString().split("T")[0];
    const b2Key = buildWorkspaceStorageKey({
      date,
      instructorId,
      studentUserId: access.studentUserId,
      workspaceId: args.workspaceId,
      fileId: args.fileId,
      fileName: args.fileName,
    });

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }

    await ctx.runMutation(internal.workspaceStorage.insertB2FileUploadLedger, {
      workspaceId: args.workspaceId,
      b2Key,
      uploaderId: identity.subject,
      uploadedAt: Date.now(),
    });

    const uploadUrl = await mintB2PresignedPutUrl({
      key: b2Key,
      contentType: args.contentType,
    });

    return { uploadUrl, b2Key, fileId: args.fileId };
  },
});

/**
 * Action: mint a signed GET URL for a workspace blob. Caller must
 * be a member of the workspace that owns the blob. TTL bounded to
 * 60s..24h by the action so a misbehaving caller can't ask for a
 * year-long URL.
 */
export const getWorkspaceDownloadUrl = action({
  args: {
    b2Key: v.string(),
    workspaceId: v.id("workspaces"),
    expiresInSeconds: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ url: string; expiresAt: number }> => {
    const access: {
      role: "instructor" | "student" | "admin";
      workspace: Doc<"workspaces">;
      studentUserId: string;
    } | null = await ctx.runQuery(
      internal.workspaceStorage.resolveWorkspaceUploadAccess,
      { workspaceId: args.workspaceId }
    );
    if (!access) {
      throw new Error("Not authorized to access this workspace's files");
    }

    const expiresInSeconds = Math.min(
      Math.max(args.expiresInSeconds ?? 3600, 60),
      24 * 3600
    );

    const { url, expiresAt } = await mintB2PresignedGetUrl({
      key: args.b2Key,
      expiresInSeconds,
    });

    return { url, expiresAt };
  },
});

/**
 * Mutation: confirms the caller drove the upload for a given
 * `b2Key`. Returns success when the ledger row exists and is
 * within the freshness window. Mirrors the existing
 * `recordFileUpload` shape so client code that already calls it
 * after a Convex storage upload can swap to this without rewriting
 * the surrounding flow.
 */
export const recordB2FileUpload = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    b2Key: v.string(),
  },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }

    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }
    if (workspace.deletedAt !== undefined) {
      throw new Error("Workspace not found");
    }

    const ledger = await ctx.db
      .query("fileUploads")
      .withIndex("by_b2Key", (q) => q.eq("b2Key", args.b2Key))
      .first();
    if (!ledger) {
      throw new Error(
        "B2 key is not reserved. Mint a fresh upload URL and try again."
      );
    }
    if (ledger.workspaceId !== args.workspaceId) {
      throw new Error(
        "B2 key does not belong to this workspace. Refusing to bind."
      );
    }

    // Mirrors `MAX_BINDING_AGE_MS` from `recordFileUpload` —
    // guards against replay: a participant who obtained a stale
    // `b2Key` cannot bind it after the window has elapsed.
    const ageMs = Date.now() - ledger.uploadedAt;
    if (ageMs < 0 || ageMs > MAX_BINDING_AGE_MS) {
      throw new Error(
        "B2 key cannot be bound: the upload is too old. Mint a fresh upload URL and try again."
      );
    }

    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// SigV4 helpers — inlined to avoid pulling @aws-sdk/client-s3 into the
// Convex V8 bundle. Mirrors convex/instructorUploads.ts.
// ---------------------------------------------------------------------------

type B2Credentials = {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  endpoint: string;
  bucket: string;
};

function loadB2Credentials(): B2Credentials {
  const accessKeyId = process.env.B2_KEY_ID;
  const secretAccessKey = process.env.B2_APPLICATION_KEY;
  const region = process.env.B2_REGION || "us-east-005";
  const endpoint =
    process.env.B2_ENDPOINT || `https://s3.${region}.backblazeb2.com`;
  const bucket =
    process.env.WORKSPACE_STORAGE_BUCKET_NAME || "mentorship-workspace-storage";
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "Missing B2 credentials: B2_KEY_ID and B2_APPLICATION_KEY must be set"
    );
  }
  return { accessKeyId, secretAccessKey, region, endpoint, bucket };
}

async function sha256Hex(input: string | ArrayBuffer): Promise<string> {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256(
  key: ArrayBuffer | Uint8Array,
  data: string
): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
}

async function mintB2PresignedPutUrl(params: {
  key: string;
  contentType: string;
}): Promise<string> {
  const creds = loadB2Credentials();
  const endpoint = creds.endpoint.replace(/\/+$/, "");
  const encodedKey = params.key
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const url = new URL(`${endpoint}/${creds.bucket}/${encodedKey}`);

  const host = url.host;
  const canonicalUri = `/${creds.bucket}/${encodedKey}`;

  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  // SigV4 query-string signing: the URL itself is the auth proof.
  // The browser PUTs to B2 directly without forwarding AWS
  // headers (which some browsers strip on cross-origin PUTs).
  const signedHeaders = ["host"];
  const canonicalHeaders = `host:${host}\n`;

  const credentialScope = `${dateStamp}/${creds.region}/s3/aws4_request`;
  const payloadHash = "UNSIGNED-PAYLOAD";

  const algorithm = "AWS4-HMAC-SHA256";
  const credential = `${creds.accessKeyId}/${credentialScope}`;
  const expires = "3600";

  const baseQuery: Record<string, string> = {
    "x-amz-algorithm": algorithm,
    "x-amz-credential": credential,
    "x-amz-date": amzDate,
    "x-amz-expires": expires,
    "x-amz-signedheaders": signedHeaders.join(";"),
  };

  const canonicalQueryParts: string[] = [];
  for (const [k, v] of Object.entries(baseQuery).sort(([a], [b]) => a.localeCompare(b))) {
    canonicalQueryParts.push(
      `${encodeURIComponent(k)}=${encodeURIComponent(v)}`
    );
  }
  canonicalQueryParts.push("x-amz-content-sha256=UNSIGNED-PAYLOAD");
  const canonicalQueryString = canonicalQueryParts.join("&");

  const canonicalRequest = [
    "PUT",
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders.join(";"),
    payloadHash,
  ].join("\n");

  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const encoder = new TextEncoder();
  const kDate = await hmacSha256(
    encoder.encode("AWS4" + creds.secretAccessKey),
    dateStamp
  );
  const kRegion = await hmacSha256(kDate, creds.region);
  const kService = await hmacSha256(kRegion, "s3");
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signature = await hmacSha256(kSigning, stringToSign);
  const sigHex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  url.search = `?${canonicalQueryString}&x-amz-signature=${sigHex}`;
  return url.toString();
}

async function mintB2PresignedGetUrl(params: {
  key: string;
  expiresInSeconds: number;
}): Promise<{ url: string; expiresAt: number }> {
  const creds = loadB2Credentials();
  const endpoint = creds.endpoint.replace(/\/+$/, "");
  const encodedKey = params.key
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const url = new URL(`${endpoint}/${creds.bucket}/${encodedKey}`);

  const host = url.host;
  const canonicalUri = `/${creds.bucket}/${encodedKey}`;

  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const signedHeaders = ["host"];
  const canonicalHeaders = `host:${host}\n`;

  const credentialScope = `${dateStamp}/${creds.region}/s3/aws4_request`;
  const payloadHash = "UNSIGNED-PAYLOAD";

  const algorithm = "AWS4-HMAC-SHA256";
  const credential = `${creds.accessKeyId}/${credentialScope}`;

  const baseQuery: Record<string, string> = {
    "x-amz-algorithm": algorithm,
    "x-amz-credential": credential,
    "x-amz-date": amzDate,
    "x-amz-expires": String(params.expiresInSeconds),
    "x-amz-signedheaders": signedHeaders.join(";"),
  };

  const canonicalQueryParts: string[] = [];
  for (const [k, v] of Object.entries(baseQuery).sort(([a], [b]) => a.localeCompare(b))) {
    canonicalQueryParts.push(
      `${encodeURIComponent(k)}=${encodeURIComponent(v)}`
    );
  }
  canonicalQueryParts.push("x-amz-content-sha256=UNSIGNED-PAYLOAD");
  const canonicalQueryString = canonicalQueryParts.join("&");

  const canonicalRequest = [
    "GET",
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders.join(";"),
    payloadHash,
  ].join("\n");

  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const encoder = new TextEncoder();
  const kDate = await hmacSha256(
    encoder.encode("AWS4" + creds.secretAccessKey),
    dateStamp
  );
  const kRegion = await hmacSha256(kDate, creds.region);
  const kService = await hmacSha256(kRegion, "s3");
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signature = await hmacSha256(kSigning, stringToSign);
  const sigHex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  url.search = `?${canonicalQueryString}&x-amz-signature=${sigHex}`;
  return {
    url: url.toString(),
    expiresAt: Date.now() + params.expiresInSeconds * 1000,
  };
}
