/**
 * On-demand operator script: write a B2 LifecycleConfiguration
 * for the workspace bucket. Pairs with the daily
 * `cleanupExpiredWorkspaceB2Uploads` cron
 * (`convex/cleanup/workspaceB2Retention.ts`) — the cron is the
 * source of truth on the Convex side; the lifecycle rule is the
 * safety net for objects the ledger has lost track of (operator
 * intervention, schema migration bugs, manual row deletion).
 *
 * Usage:
 *   B2_KEY_ID=<key> B2_APPLICATION_KEY=<key> \
 *     B2_BUCKET_NAME=mentorship-workspace-storage \
 *     B2_REGION=us-east-005 \
 *     npx tsx scripts/set-b2-bucket-lifecycle.ts [--dry-run]
 *
 * Flags:
 *   --dry-run   print the LifecycleConfiguration XML that
 *               would be PUT without actually sending the
 *               request. Useful for confirming the
 *               pair-rule + the 18-month window match the
 *               `WORKSPACE_RETENTION_MS` constant in
 *               `convex/workspaceConstants.ts`.
 *
 * Pair-rule caveat: B2's S3-compatible LifecycleConfiguration
 * parser REQUIRES every `Expiration` block to include both
 * `Days` AND `ExpiredObjectDeleteMarker=true`. Without
 * `ExpiredObjectDeleteMarker`, B2 returns
 * `MalformedXML error` and rejects the PUT. Versioning on
 * the bucket is also required for the lifecycle rule to
 * take effect — without it, B2 silently ignores the rule.
 *
 * The 540-day Expiration window matches `WORKSPACE_RETENTION_MS`
 * (18 months ≈ 540 days). If you change `WORKSPACE_RETENTION_MS`
 * in `convex/workspaceConstants.ts`, also update `RETENTION_DAYS`
 * below — the two are intentionally duplicated so the cron
 * (Convex-side, source of truth) and the lifecycle rule
 * (B2-side, safety net) age out at the same time.
 *
 * Up to 1,000 LifecycleConfiguration rules per bucket. Today we
 * only emit one; the script uses the
 * `LifecycleConfiguration` root element with a single `Rule`
 * so adding more is a one-line edit later.
 */

const RETENTION_DAYS = 540;
const RULE_ID = "workspace-retention-18mo";
const RULE_STATUS = "Enabled";

type Args = { dryRun: boolean };

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false };
  for (const arg of argv) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: B2_KEY_ID=... B2_APPLICATION_KEY=... B2_BUCKET_NAME=... npx tsx scripts/set-b2-bucket-lifecycle.ts [--dry-run]"
      );
      process.exit(0);
    }
  }
  return args;
}

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
    process.env.B2_BUCKET_NAME || "mentorship-workspace-storage";
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "Missing B2 credentials: B2_KEY_ID and B2_APPLICATION_KEY must be set"
    );
  }
  return { accessKeyId, secretAccessKey, region, endpoint, bucket };
}

function buildLifecycleXml(): string {
  // Pair-rule requirement: B2 requires BOTH Days AND
  // ExpiredObjectDeleteMarker=true on every Expiration block.
  // See AGENTS.md "Pair-rule requirement" section.
  return `<?xml version="1.0" encoding="UTF-8"?>
<LifecycleConfiguration>
  <Rule>
    <ID>${RULE_ID}</ID>
    <Status>${RULE_STATUS}</Status>
    <Expiration>
      <Days>${RETENTION_DAYS}</Days>
      <ExpiredObjectDeleteMarker>true</ExpiredObjectDeleteMarker>
    </Expiration>
  </Rule>
</LifecycleConfiguration>`;
}

async function sha256Hex(text: string): Promise<string> {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const keyBytes = key instanceof Uint8Array ? new Uint8Array(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function putLifecycle(creds: B2Credentials, xml: string): Promise<void> {
  const endpoint = creds.endpoint.replace(/\/+$/, "");
  const url = `${endpoint}/${creds.bucket}?lifecycle`;
  const parsedUrl = new URL(url);
  const host = parsedUrl.host;
  const canonicalUri = `/${creds.bucket}`;
  // Lower-case + lexicographically sorted query string.
  const canonicalQueryString = "lifecycle";
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = await sha256Hex(xml);
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    "PUT",
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${creds.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
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
  const signature = toHex(await hmacSha256(kSigning, stringToSign));
  const authorization = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: authorization,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      "Content-Type": "application/xml",
    },
    body: xml,
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `B2 lifecycle PUT failed: ${response.status} ${response.statusText} — ${body}`
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const creds = loadB2Credentials();
  const xml = buildLifecycleXml();
  if (args.dryRun) {
    console.log(`[dry-run] would PUT lifecycle to ${creds.bucket} (region ${creds.region}):`);
    console.log(xml);
    return;
  }
  await putLifecycle(creds, xml);
  console.log(
    `OK: LifecycleConfiguration written to ${creds.bucket} (region ${creds.region}). Rule: ${RULE_ID} expires after ${RETENTION_DAYS} days.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
