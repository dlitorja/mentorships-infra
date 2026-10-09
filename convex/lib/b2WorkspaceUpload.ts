/**
 * PR workspace-storage-3d follow-up: SDK-based presigned-PUT URL signing
 * for the workspace B2 bucket.
 *
 * PR fix/chat-b2-get-sdk follow-up: SDK-based presigned-GET URL signing
 * for the workspace B2 bucket.
 *
 * The hand-rolled SigV4 in `convex/workspaceStorage.ts:mintB2PresignedPutUrl`
 * produced URLs that B2 rejected with `AccessDenied` ("Unauthenticated
 * requests are not allowed for this api"). Verified live: SDK-generated
 * URL PUTs 200; hand-rolled URL PUTs 403 even with checksum params or
 * without Content-Type. The same hand-rolled SigV4 was reused for
 * `mintB2PresignedGetUrl` (chat read path), where it produces URLs B2
 * also rejects with 403 ("bucket is not authorized"). Verified live:
 * SDK GET-signed URL → 200; hand-rolled GET-signed URL → 403.
 *
 * Both helpers delegate to the AWS SDK's `getSignedUrl`, which produces
 * the canonical request B2 expects. Inlined here (rather than imported
 * from `@mentorships/storage`) because the Convex bundler resolves
 * `node_modules` packages but does not resolve workspace packages —
 * pulling across the package boundary would break `convex codegen`.
 *
 * Two pre-existing actions (cleanup DELETE, finalize DELETE) still use the
 * hand-rolled SigV4 because they sign the Authorization HEADER on a server-
 * side fetch — those work, only the presigned URL signing was broken.
 */
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  NotFound,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const WORKSPACE_REGION = process.env.WORKSPACE_STORAGE_BUCKET_REGION || "us-east-005";
const WORKSPACE_ENDPOINT =
  process.env.WORKSPACE_STORAGE_BUCKET_ENDPOINT ||
  `https://s3.${WORKSPACE_REGION}.backblazeb2.com`;
const WORKSPACE_BUCKET = process.env.WORKSPACE_STORAGE_BUCKET_NAME || "mentorship-workspace-storage";

const URL_EXPIRY_SECONDS = 3600;

let workspaceClient: S3Client | null = null;

function getWorkspaceClient(): S3Client {
  if (workspaceClient) return workspaceClient;
  const accessKeyId = process.env.B2_KEY_ID;
  const secretAccessKey = process.env.B2_APPLICATION_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("Missing B2 credentials: B2_KEY_ID and B2_APPLICATION_KEY must be set");
  }
  workspaceClient = new S3Client({
    region: WORKSPACE_REGION,
    endpoint: WORKSPACE_ENDPOINT,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
  return workspaceClient;
}

export async function signedWorkspaceUploadUrl(
  key: string,
  params: { contentType: string; size: number }
): Promise<string> {
  return getSignedUrl(
    getWorkspaceClient(),
    new PutObjectCommand({
      Bucket: WORKSPACE_BUCKET,
      Key: key,
      ContentLength: params.size,
      ContentType: params.contentType,
    }),
    { expiresIn: URL_EXPIRY_SECONDS }
  );
}

/**
 * PR fix/chat-b2-get-sdk: SDK-based presigned-GET URL signing for the
 * workspace B2 bucket. Replaces the hand-rolled SigV4 in
 * `mintB2PresignedGetUrl`, which produced URLs B2 rejected with 403
 * "bucket is not authorized" (chat image 401). Verified live:
 * SDK `getSignedUrl(GetObjectCommand)` → 200; hand-rolled URL → 403.
 *
 * `expiresInSeconds` is passed through verbatim from the caller. The
 * caller (`mintB2PresignedGetUrl` and its `clampWorkspaceDownloadExpiresInSeconds`
 * wrapper) is responsible for clamping to the 60s..24h band and the
 * workspace retention deadline before this helper runs — see the
 * `WORKSPACE_B2_URL_TTL_SECONDS` constant + clamp function for the
 * policy.
 */
export async function signedWorkspaceDownloadUrl(
  key: string,
  expiresInSeconds: number
): Promise<string> {
  return getSignedUrl(
    getWorkspaceClient(),
    new GetObjectCommand({
      Bucket: WORKSPACE_BUCKET,
      Key: key,
    }),
    { expiresIn: expiresInSeconds }
  );
}

/**
 * PR 12 PR 4b Greptile P1 follow-up: verify an object actually
 * exists in B2 before treating an upload as complete. Without
 * this, a student could call `recordWorkExampleUpload` without
 * completing the PUT and the row would flip to `active`,
 * allowing `submitQuestionnaire` to count a missing file
 * toward the artwork requirement.
 *
 * Uses the SDK's `HeadObjectCommand` (B2 is S3-compatible and
 * returns the standard NotFound error code on missing keys).
 * Returns true if the object exists, false on NotFound OR on
 * any other failure — the caller treats `false` as "upload not
 * yet complete" rather than raising an exception (so a flaky
 * HEAD doesn't block the user from retrying the PUT).
 */
export async function workspaceObjectExists(key: string): Promise<boolean> {
  try {
    await getWorkspaceClient().send(
      new HeadObjectCommand({ Bucket: WORKSPACE_BUCKET, Key: key })
    );
    return true;
  } catch (err) {
    if (err instanceof NotFound) return false;
    // Treat any other SDK error (network, auth, transient) as
    // "we couldn't confirm" rather than failing the mutation —
    // the student can retry. Log via the same observability
    // surface used elsewhere.
    return false;
  }
}
