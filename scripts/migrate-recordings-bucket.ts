/**
 * Operator script: move call recordings out of the legacy shared bucket
 * into the dedicated recordings bucket.
 *
 * Background: before `RECORDINGS_BUCKET_NAME` existed, the transfer task
 * uploaded through `@mentorships/storage`, which resolves
 * `B2_BUCKET_NAME`. Runtimes disagreed about that value, so live
 * transfers landed in `instructor-uploads` while the signing path read
 * `mentorship-call-storage` — those recordings are unplayable, and a
 * purge against the wrong bucket no-ops silently (S3 `DeleteObject` is
 * idempotent).
 *
 * This script copies each `recordings/…` object server-side, verifies
 * the copy by size, and only then deletes the source. It is idempotent:
 * re-running skips objects already present at the target with the same
 * size.
 *
 * It does NOT touch `sessions.recordingUrl` — keys are unchanged
 * (`recordings/{sessionId}/{recordingId}.mp4`), only the bucket they
 * live in, so no Convex write is required.
 *
 * Usage:
 *   # 1. see what would move (no writes)
 *   B2_KEY_ID=… B2_APPLICATION_KEY=… \
 *     npx tsx scripts/migrate-recordings-bucket.ts --dry-run
 *
 *   # 2. move everything (verify-by-size before deleting the source)
 *   ... --apply
 *
 *   # 3. move a single object
 *   ... --apply --key "recordings/kd7abc/rec.mp4"
 *
 *   # 4. remove the leftover size-probe files from the recordings bucket
 *   ... --apply --purge-probes     # additive: migrates AND purges
 *
 * Env:
 *   RECORDINGS_BUCKET_NAME  target (default `mentorship-call-storage`)
 *   LEGACY_RECORDINGS_SOURCE_BUCKET  source (default `instructor-uploads`)
 *   B2_REGION (default `us-east-005`), B2_ENDPOINT (derived)
 */
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
  type _Object,
} from "@aws-sdk/client-s3";

const DEFAULT_TARGET = "mentorship-call-storage";
const DEFAULT_SOURCE = "instructor-uploads";
const PROBE_PREFIX = "test-size-bound-";
const RECORDINGS_PREFIX = "recordings/";

type Args = {
  apply: boolean;
  purgeProbes: boolean;
  key?: string;
};

function parseArgs(argv: string[]): Args {
  const keyIndex = argv.indexOf("--key");
  const key = keyIndex >= 0 ? argv[keyIndex + 1] : undefined;
  if (keyIndex >= 0 && !key) {
    throw new Error("--key requires a value");
  }
  if (key !== undefined && !key.startsWith(RECORDINGS_PREFIX)) {
    // Without this guard an operator could move an instructor-upload or
    // workspace file into the recordings bucket and delete the original,
    // breaking every existing link to it.
    throw new Error(
      `--key must start with "${RECORDINGS_PREFIX}" (got "${key}")`
    );
  }
  return {
    apply: argv.includes("--apply"),
    purgeProbes: argv.includes("--purge-probes"),
    key,
  };
}

function loadConfig() {
  const accessKeyId = process.env.B2_KEY_ID;
  const secretAccessKey = process.env.B2_APPLICATION_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "Missing B2 credentials: B2_KEY_ID and B2_APPLICATION_KEY must be set"
    );
  }

  const region = process.env.B2_REGION || "us-east-005";
  return {
    region,
    endpoint:
      process.env.B2_ENDPOINT || `https://s3.${region}.backblazeb2.com`,
    target: process.env.RECORDINGS_BUCKET_NAME || DEFAULT_TARGET,
    source:
      process.env.LEGACY_RECORDINGS_SOURCE_BUCKET || DEFAULT_SOURCE,
    accessKeyId,
    secretAccessKey,
  };
}

/**
 * Moving objects between a bucket and itself is not a move. Both size
 * checks would read the same object, so a matching size would not prove a
 * second copy exists — and the `--apply` path would delete the only copy.
 */
export function assertDistinctBuckets(source: string, target: string): void {
  if (source === target) {
    throw new Error(
      `Refusing to run: source and target are the same bucket ("${source}"). ` +
        "Set LEGACY_RECORDINGS_SOURCE_BUCKET and RECORDINGS_BUCKET_NAME to " +
        "different buckets."
    );
  }
}

function makeClient(config: ReturnType<typeof loadConfig>): S3Client {
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

async function listKeys(
  client: S3Client,
  bucket: string,
  prefix: string
): Promise<_Object[]> {
  const out: _Object[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token })
    );
    out.push(...(page.Contents ?? []));
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return out;
}

async function headSize(
  client: S3Client,
  bucket: string,
  key: string
): Promise<number | null> {
  try {
    const head = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key })
    );
    return head.ContentLength ?? null;
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === "NotFound" || name === "NoSuchKey") return null;
    throw error;
  }
}

function encodeCopySource(bucket: string, key: string): string {
  return `${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  assertDistinctBuckets(config.source, config.target);
  const client = makeClient(config);

  console.log(
    `source: ${config.source} → target: ${config.target} (${config.region})` +
      (args.apply ? "" : "  [DRY RUN — no writes]")
  );

  if (args.purgeProbes) {
    const probes = await listKeys(client, config.target, PROBE_PREFIX);
    if (probes.length === 0) {
      console.log(`No "${PROBE_PREFIX}*" objects in ${config.target}.`);
    }
    for (const probe of probes) {
      if (!probe.Key) continue;
      if (!args.apply) {
        console.log(`[dry-run] would delete probe ${config.target}/${probe.Key}`);
        continue;
      }
      await client.send(
        new DeleteObjectCommand({ Bucket: config.target, Key: probe.Key })
      );
      console.log(`deleted probe ${config.target}/${probe.Key}`);
    }
    // NOTE: do NOT return here. `--purge-probes` is additive: an operator
    // running the script expects the migration to happen too. Returning
    // early made `--apply --purge-probes` delete the probes and quietly
    // skip every recording (hit in production on 2026-11-03).
  }

  const objects = args.key
    ? [{ Key: args.key, Size: (await headSize(client, config.source, args.key)) ?? undefined }]
    : await listKeys(client, config.source, RECORDINGS_PREFIX);

  if (objects.length === 0) {
    console.log(`No "${RECORDINGS_PREFIX}" objects in ${config.source}. Nothing to do.`);
    return;
  }

  let moved = 0;
  let skipped = 0;
  const failures: string[] = [];

  for (const object of objects) {
    const key = object.Key;
    if (!key) continue;

    try {
      const sourceSize =
        object.Size ?? (await headSize(client, config.source, key));
      if (sourceSize === undefined || sourceSize === null) {
        failures.push(`${key}: source object disappeared during the run`);
        continue;
      }

      const targetSize = await headSize(client, config.target, key);
      if (targetSize === sourceSize) {
        // A previous run copied but never deleted the source (or its
        // delete failed). Retention only deletes from the recordings
        // bucket and then marks the session `purged`, so leaving the
        // legacy copy here orphans it forever. Finish the job.
        if (!args.apply) {
          skipped++;
          console.log(
            `[dry-run] would delete duplicate source (target already matches, ${sourceSize} bytes) ${config.source}/${key}`
          );
          continue;
        }
        await client.send(
          new DeleteObjectCommand({ Bucket: config.source, Key: key })
        );
        moved++;
        console.log(`deleted duplicate source (target already matched) ${key}`);
        continue;
      }

      if (!args.apply) {
        console.log(`[dry-run] would copy ${sourceSize} bytes: ${config.source}/${key} → ${config.target}/${key}`);
        continue;
      }

      await client.send(
        new CopyObjectCommand({
          Bucket: config.target,
          Key: key,
          CopySource: encodeCopySource(config.source, key),
        })
      );

      // Verify by size before deleting the source. A CopyObject that
      // returns 200 but leaves a truncated/missing object must not
      // destroy the only copy.
      const copiedSize = await headSize(client, config.target, key);
      if (copiedSize !== sourceSize) {
        failures.push(
          `${key}: copy verification failed (source ${sourceSize} bytes, target ${copiedSize ?? "missing"}) — source left in place`
        );
        continue;
      }

      await client.send(
        new DeleteObjectCommand({ Bucket: config.source, Key: key })
      );
      moved++;
      console.log(`moved ${sourceSize} bytes ${key}`);
    } catch (error) {
      failures.push(
        `${key}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  console.log(
    `\nmoved=${moved} skipped=${skipped} failed=${failures.length}` +
      (args.apply ? "" : "  (dry run — nothing written)")
  );
  if (failures.length > 0) {
    for (const failure of failures) console.error(`  FAILED ${failure}`);
    process.exitCode = 1;
  }
}

// Only run when invoked directly so the exported helpers stay unit-testable.
if (process.env.VITEST === undefined) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
