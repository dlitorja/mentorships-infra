/**
 * Operator script: add an **abort-incomplete-multipart-upload** lifecycle
 * rule to a Backblaze B2 bucket.
 *
 * Scope: `huckleberry-drive-files` (the bucket the huckleberry-drive
 * browser multipart flow writes to). This rule ONLY aborts unfinished
 * multipart uploads — it never expires or deletes completed objects.
 *
 * Why 7 days (not the 1–24h figure from most blog posts):
 *   - `packages/storage/src/uploads.ts` presigns each part for
 *     `URL_EXPIRY_SECONDS = 3600` (1 hour), but a suspended browser or
 *     a mobile tab can resume well past that.
 *   - `DEFAULT_PART_SIZE` is 100 MB with up to 200 parts (20 GiB), so a
 *     real upload can legitimately span hours on a slow link.
 *   - 7 days is >2x any realistic resume window and is the shortest
 *     value that cannot kill a legitimate slow upload. B2 granularity
 *     is days.
 *
 * Why this script exists at all:
 *   - `packages/storage/src/uploads.ts` aborts a multipart upload only
 *     when presigning fails after `CreateMultipartUpload`. The
 *     huckleberry-drive app has an explicit `/api/uploads/abort` route,
 *     which only fires if the *client* asks. A client that simply walks
 *     away leaves orphaned parts, which B2 bills as stored data.
 *   - Verified 2026-11-02: exactly one abandoned upload existed
 *     (`huckleberry-drive-files`, 0 bytes uploaded, initiated
 *     2026-08-06). Present cost is ~$0; this rule prevents a future
 *     billable orphan, it does not save money today.
 *
 * IMPORTANT — this is NOT the workspace retention rule.
 *   `scripts/set-b2-bucket-lifecycle.ts` (an object-age Expiration rule
 *   on the workspace bucket) was added in PR #888 round 2 and deleted in
 *   round 4 (Greptile P1 #10): B2 lifecycle rules operate on objects,
 *   not references, so a 540-day rule can delete a file a live workspace
 *   still links. `convex/crons.ts` documents
 *   `cleanup-expired-workspace-b2-uploads` as the sole source of truth
 *   for workspace retention. Do not reintroduce that rule.
 *
 * Same reasoning applies to a `recordings/` Expiration rule: the app's
 * deadline is `recordingExpiresAt` (upload + `RECORDING_RETENTION_DAYS`,
 * env-tunable), so an age-keyed rule can delete early if retention is
 * ever raised. Any such rule must be at least 2x the configured
 * retention and is intentionally out of scope here.
 *
 * Merge safety: `PutBucketLifecycleConfiguration` REPLACES the whole
 * configuration. This script reads the current rules first and merges
 * by rule ID instead of clobbering; it refuses to run if a rule with
 * the same ID but a different body already exists.
 *
 * Usage:
 *   B2_KEY_ID=<key> B2_APPLICATION_KEY=<key> \
 *     npx tsx scripts/set-b2-lifecycle-abort-multipart.ts --dry-run
 *
 *   # apply (operator action, after reviewing the dry-run output):
 *   B2_KEY_ID=... B2_APPLICATION_KEY=... \
 *     npx tsx scripts/set-b2-lifecycle-abort-multipart.ts --apply
 *
 *   # confirm what the bucket actually has now:
 *   ... --verify
 *
 * Env (defaults match the production deployment):
 *   B2_BUCKET_NAME  default `huckleberry-drive-files`
 *   B2_REGION       default `us-east-005`
 *   B2_ENDPOINT     default `https://s3.<region>.backblazeb2.com`
 */
import {
  S3Client,
  GetBucketLifecycleConfigurationCommand,
  PutBucketLifecycleConfigurationCommand,
  type LifecycleRule,
} from "@aws-sdk/client-s3";

const RULE_ID = "abort-incomplete-multipart-7d";
const DAYS_AFTER_INITIATION = 7;

type Args = { mode: "dry-run" | "apply" | "verify" };

function parseArgs(argv: string[]): Args {
  const has = (flag: string) => argv.includes(flag);
  const selected = [
    has("--dry-run") ? "dry-run" : null,
    has("--apply") ? "apply" : null,
    has("--verify") ? "verify" : null,
  ].filter(Boolean) as Args["mode"][];

  if (selected.length !== 1) {
    throw new Error(
      "Pass exactly one of --dry-run, --apply, --verify (see the header comment)."
    );
  }
  return { mode: selected[0] };
}

type B2Config = {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  endpoint: string;
  bucket: string;
};

function loadConfig(): B2Config {
  const accessKeyId = process.env.B2_KEY_ID;
  const secretAccessKey = process.env.B2_APPLICATION_KEY;
  const region = process.env.B2_REGION || "us-east-005";
  const endpoint =
    process.env.B2_ENDPOINT || `https://s3.${region}.backblazeb2.com`;
  const bucket = process.env.B2_BUCKET_NAME || "huckleberry-drive-files";

  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "Missing B2 credentials: B2_KEY_ID and B2_APPLICATION_KEY must be set"
    );
  }
  return { accessKeyId, secretAccessKey, region, endpoint, bucket };
}

export function buildRule(): LifecycleRule {
  return {
    ID: RULE_ID,
    Status: "Enabled",
    // Empty prefix = every object in the bucket. The rule only acts on
    // unfinished multipart uploads, so it cannot affect stored objects.
    Filter: { Prefix: "" },
    AbortIncompleteMultipartUpload: {
      DaysAfterInitiation: DAYS_AFTER_INITIATION,
    },
  };
}

export function mergeRules(existing: LifecycleRule[]): LifecycleRule[] {
  const next = buildRule();
  const sameId = existing.find((rule) => rule.ID === RULE_ID);

  if (sameId) {
    const identical =
      sameId.Status === next.Status &&
      sameId.AbortIncompleteMultipartUpload?.DaysAfterInitiation ===
        DAYS_AFTER_INITIATION;
    if (!identical) {
      throw new Error(
        `A rule with ID "${RULE_ID}" already exists with a different body. ` +
          "Refusing to overwrite it — reconcile by hand first."
      );
    }
    return [sameId, ...existing.filter((rule) => rule.ID !== RULE_ID)];
  }

  return [next, ...existing];
}

function makeClient(config: B2Config): S3Client {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

async function readExistingRules(
  client: S3Client,
  bucket: string
): Promise<LifecycleRule[]> {
  try {
    const response = await client.send(
      new GetBucketLifecycleConfigurationCommand({ Bucket: bucket })
    );
    return response.Rules ?? [];
  } catch (error) {
    // B2 returns NoSuchLifecycleConfiguration when the bucket has no
    // rules at all — that is the expected starting state, not an error.
    const name = (error as { name?: string }).name;
    if (name === "NoSuchLifecycleConfiguration") return [];
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const client = makeClient(config);

  const existing = await readExistingRules(client, config.bucket);

  if (args.mode === "verify") {
    const rule = existing.find((r) => r.ID === RULE_ID);
    if (!rule) {
      console.log(
        `NOT PRESENT: no "${RULE_ID}" rule on ${config.bucket} (${existing.length} rule(s) total).`
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      `OK: "${RULE_ID}" present on ${config.bucket} — aborts incomplete multipart uploads after ` +
        `${rule.AbortIncompleteMultipartUpload?.DaysAfterInitiation} day(s). Total rules: ${existing.length}.`
    );
    return;
  }

  const merged = mergeRules(existing);

  if (args.mode === "dry-run") {
    console.log(
      `[dry-run] would PUT ${merged.length} rule(s) to ${config.bucket} (${config.region}):`
    );
    console.log(JSON.stringify(merged, null, 2));
    console.log(
      "\nNo Expiration rule is included — completed objects are never touched by this script."
    );
    return;
  }

  await client.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: config.bucket,
      LifecycleConfiguration: { Rules: merged },
    })
  );

  // Re-read instead of trusting the PUT response: B2 has historically
  // accepted writes it then ignores (see the versioning caveat below).
  const after = await readExistingRules(client, config.bucket);
  const applied = after.find((rule) => rule.ID === RULE_ID);
  if (!applied) {
    throw new Error(
      `PUT succeeded but "${RULE_ID}" is not present on read-back. ` +
        "B2 silently ignores lifecycle rules on some bucket configurations — " +
        "check bucket versioning in the console before retrying."
    );
  }

  console.log(
    `OK: "${RULE_ID}" written to ${config.bucket} (${config.region}) and confirmed by read-back. ` +
      `Aborts incomplete multipart uploads after ${DAYS_AFTER_INITIATION} days. Total rules: ${after.length}.`
  );
}

// Only run when invoked directly so the exported helpers stay unit-testable.
if (process.env.VITEST === undefined) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
