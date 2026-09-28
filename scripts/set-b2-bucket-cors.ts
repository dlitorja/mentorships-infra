/**
 * Apply CORS rules to the workspace-storage B2 bucket.
 *
 * PR workspace-storage-3c cut over uploads to B2, but the bucket
 * never had CORS rules applied — so presigned GET URLs returned
 * by `resolveWorkspaceB2FileUploadsForKeys` cannot be loaded
 * from the browser (the browser's preflight OPTIONS request is
 * rejected with "No 'Access-Control-Allow-Origin' header"), and
 * the browser PUT in `uploadFileToB2` is rejected for the same
 * reason.
 *
 * This script applies the canonical CORS ruleset via the B2
 * S3-compatible `PutBucketCors` API. Idempotent — re-running
 * replaces the existing ruleset atomically (B2 stores one
 * `CORSConfiguration` per bucket).
 *
 * Origins allowed:
 *
 * Custom domains (production + apex wildcard):
 *   - https://mentorships.huckleberry.art (apps/web production)
 *   - https://dev.mentorships.huckleberry.art (apps/platform
 *     preview; Vercel project `mentorships-infra-platform` uses
 *     this as its production URL via the custom-domain attach)
 *   - https://*.huckleberry.art (apex wildcard — covers
 *     `drive.huckleberry.art` for huckleberry-drive and any
 *     future subdomain without a script re-run)
 *
 * Vercel branch deploys (preview URLs of the form
 * `<project>-<hash>.vercel.app` for any project in the team):
 *   - https://*.vercel.app
 *
 * Local dev (B2 does not support port wildcards in
 * AllowedOrigins — see B2 docs; each port is enumerated):
 *   - http://localhost
 *   - http://localhost:3000, :3001, :8080
 *   - http://127.0.0.1
 *   - http://127.0.0.1:3000, :3001, :8080
 *
 * Methods: GET + HEAD + PUT.
 *   - GET/HEAD: the read path — `resolveWorkspaceB2FileUploadsForKeys`
 *     mints presigned GET URLs that the browser loads to render
 *     gallery images, chat attachments, note comment images, and
 *     note editor images.
 *   - PUT: the write path — `apps/platform/lib/b2-workspace-upload.ts`
 *     `uploadFileToB2` PUTs the raw bytes directly from the browser
 *     using the presigned PUT URL minted by
 *     `generateWorkspaceUploadUrl`. Authorization is the presigned
 *     URL itself (the x-amz-signature is scoped to the key + TTL),
 *     so CORS PUT against this bucket is part of the design, not a
 *     risk: only callers who successfully ran the Convex action
 *     (which checks workspace membership, slot count, file size,
 *     etc.) can mint a PUT URL.
 *
 *   POST and DELETE are NOT allowed. The server-side actions
 *   (`deleteFromB2WorkspaceAction`, etc.) talk to B2 from Node.js,
 *   which is not CORS-restricted, so the browser never needs them.
 *
 * B2 AllowedOrigin syntax (verified against live CORS preflights):
 *   - Subdomain wildcards: `https://*.example.com` ✓
 *   - Bare scheme token: `https` matches any HTTPS origin ✓
 *   - Port wildcards (`localhost:*`): NOT supported — B2 rejects
 *     with "allowedOrigin value has '*' after the hostname." Each
 *     localhost port is enumerated.
 *   - Bare `http` token: NOT supported (only `https` has this).
 *
 * Usage:
 *   B2_KEY_ID=<key> \
 *     B2_APPLICATION_KEY=<secret> \
 *     B2_WORKSPACE_STORAGE_BUCKET_REGION=us-east-005 \
 *     npx tsx scripts/set-b2-bucket-cors.ts [--dry-run]
 *
 * Flags:
 *   --dry-run   print the CORSConfiguration that would be sent
 *               and exit without calling PutBucketCors. Useful
 *               for verifying the rule shape against the B2
 *               docs before applying.
 *
 * Env vars (all required unless --dry-run):
 *   B2_KEY_ID, B2_APPLICATION_KEY — B2 application key with
 *     `listBuckets` + `writeBucketEncryption` (or the broader
 *     `admin` capability, which covers bucket config).
 *   B2_WORKSPACE_STORAGE_BUCKET_REGION (defaults to
 *     `us-east-005`) — region of the workspace bucket. The
 *     endpoint is derived from the region.
 *
 * Behavior on a fresh bucket (Greptile P1):
 *   `GetBucketCors` throws `NoSuchCORSConfiguration` when the
 *   bucket has never had a CORS configuration. We catch that
 *   specific error and continue with an empty current ruleset
 *   so the script can provision a fresh bucket on its first run.
 *   Any other error from `GetBucketCors` (auth, network,
 *   missing bucket) still surfaces and aborts the run.
 *
 * Verification:
 *   B2_KEY_ID=<key> B2_APPLICATION_KEY=<secret> \
 *     npx tsx scripts/set-b2-bucket-cors.ts
 *   # then probe with curl:
 *   curl -i -X OPTIONS \
 *     -H "Origin: https://dev.mentorships.huckleberry.art" \
 *     -H "Access-Control-Request-Method: PUT" \
 *     "https://s3.us-east-005.backblazeb2.com/mentorship-workspace-storage/test"
 */

import {
  GetBucketCorsCommand,
  PutBucketCorsCommand,
  S3Client,
  type CORSConfiguration,
  type CORSRule,
} from "@aws-sdk/client-s3";

const BUCKET_NAME =
  process.env.B2_WORKSPACE_STORAGE_BUCKET_NAME ?? "mentorship-workspace-storage";
const BUCKET_REGION =
  process.env.B2_WORKSPACE_STORAGE_BUCKET_REGION ?? "us-east-005";
const ENDPOINT =
  process.env.B2_ENDPOINT ?? `https://s3.${BUCKET_REGION}.backblazeb2.com`;

/**
 * Canonical CORS ruleset. Single consolidated rule with every
 * supported origin enumerated. B2's GetBucketCors deduplicates
 * methods but not origins, and B2's AllowedOrigin grammar does
 * NOT support port wildcards — see the file header comment for
 * the live-verified syntax.
 */
const CORS_RULES: CORSConfiguration = {
  CORSRules: [
    {
      ID: "huckleberry-art-bucket",
      AllowedMethods: ["GET", "HEAD", "PUT"],
      AllowedOrigins: [
        "https://mentorships.huckleberry.art",
        "https://dev.mentorships.huckleberry.art",
        "https://*.huckleberry.art",
        "https://*.vercel.app",
        "http://localhost",
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:8080",
        "http://127.0.0.1",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
        "http://127.0.0.1:8080",
      ],
      AllowedHeaders: ["*"],
      ExposeHeaders: ["ETag", "Content-Length", "Content-Type"],
      MaxAgeSeconds: 3600,
    },
  ],
};

function buildClient(): S3Client {
  const accessKeyId = process.env.B2_KEY_ID;
  const secretAccessKey = process.env.B2_APPLICATION_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "Missing B2 credentials: B2_KEY_ID and B2_APPLICATION_KEY must be set (use --dry-run to skip auth).",
    );
  }
  return new S3Client({
    region: BUCKET_REGION,
    endpoint: ENDPOINT,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
}

function isNoSuchCORSConfiguration(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; Code?: string; code?: string };
  return (
    e.name === "NoSuchCORSConfiguration" ||
    e.Code === "NoSuchCORSConfiguration" ||
    e.code === "NoSuchCORSConfiguration"
  );
}

async function readCurrentRules(client: S3Client): Promise<CORSRule[]> {
  try {
    const out = await client.send(
      new GetBucketCorsCommand({ Bucket: BUCKET_NAME }),
    );
    return (out.CORSConfiguration?.CORSRules ?? []) as CORSRule[];
  } catch (err) {
    if (isNoSuchCORSConfiguration(err)) {
      console.log("No existing CORS configuration — treating as fresh bucket.");
      return [];
    }
    throw err;
  }
}

async function dryRun(): Promise<void> {
  console.log(
    JSON.stringify(
      {
        Bucket: BUCKET_NAME,
        Endpoint: ENDPOINT,
        CORSConfiguration: CORS_RULES,
      },
      null,
      2,
    ),
  );
}

async function apply(client: S3Client): Promise<void> {
  const current = await readCurrentRules(client);
  console.log("Current rules:");
  console.log(JSON.stringify(current, null, 2));

  console.log("\nApplying new rules:");
  console.log(JSON.stringify(CORS_RULES.CORSRules, null, 2));

  await client.send(
    new PutBucketCorsCommand({
      Bucket: BUCKET_NAME,
      CORSConfiguration: CORS_RULES,
    }),
  );

  const after = await readCurrentRules(client);
  console.log("\nVerified after apply:");
  console.log(JSON.stringify(after, null, 2));
}

async function main(): Promise<void> {
  const dryRunFlag = process.argv.includes("--dry-run");
  if (dryRunFlag) {
    await dryRun();
    return;
  }
  const client = buildClient();
  await apply(client);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
