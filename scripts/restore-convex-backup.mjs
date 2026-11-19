#!/usr/bin/env node
/**
 * List, download, and verify the daily Convex → B2 database backups
 * written by `src/trigger/convex-backup.ts`.
 *
 * This script is deliberately read-only. Restoring is a manual,
 * reviewed operation (see docs/runbooks/convex-backups.md): restore
 * into a fresh preview deployment first, verify, then decide whether
 * to copy rows into production.
 *
 * Usage:
 *   node scripts/restore-convex-backup.mjs --list
 *   node scripts/restore-convex-backup.mjs --download <key> --out /tmp/opencode/cb
 *   node scripts/restore-convex-backup.mjs --download <key> --out /tmp/opencode/cb --verify
 */

import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  readFileSync,
} from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import {
  GetObjectCommand,
  ListObjectVersionsCommand,
  S3Client,
} from "@aws-sdk/client-s3";

// Load the repo's local env when present so operators can run this
// without exporting B2_* / WORKSPACE_STORAGE_* by hand. Existing
// process.env values win.
for (const file of [".env.local", ".env"]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(match[1] in process.env)) process.env[match[1]] = value;
  }
}

const args = process.argv.slice(2);

function flag(name) {
  return args.includes(`--${name}`);
}
function value(name) {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
}

const BUCKET = process.env.WORKSPACE_STORAGE_BUCKET_NAME;
const REGION =
  process.env.WORKSPACE_STORAGE_BUCKET_REGION ||
  process.env.B2_REGION ||
  "us-east-005";
const ENDPOINT =
  process.env.WORKSPACE_STORAGE_BUCKET_ENDPOINT ||
  `https://s3.${REGION}.backblazeb2.com`;

function requireEnv(name, val) {
  if (!val || !val.trim()) {
    throw new Error(`${name} is not set. Load the deployment env first.`);
  }
  return val.trim();
}

function client() {
  return new S3Client({
    region: REGION,
    endpoint: ENDPOINT,
    credentials: {
      accessKeyId: requireEnv("B2_KEY_ID", process.env.B2_KEY_ID),
      secretAccessKey: requireEnv(
        "B2_APPLICATION_KEY",
        process.env.B2_APPLICATION_KEY
      ),
    },
    forcePathStyle: true,
  });
}

async function listBackupVersions() {
  const s3 = client();
  const bucket = requireEnv("WORKSPACE_STORAGE_BUCKET_NAME", BUCKET);
  const rows = [];
  let keyMarker;
  let versionIdMarker;

  do {
    const page = await s3.send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        Prefix: "convex-backups/",
        KeyMarker: keyMarker,
        VersionIdMarker: versionIdMarker,
      })
    );
    for (const version of page.Versions ?? []) {
      if (!version.Key || !version.VersionId) continue;
      if (!version.Key.endsWith(".zip") && !version.Key.endsWith(".manifest.json")) {
        continue;
      }
      rows.push({
        key: version.Key,
        versionId: version.VersionId,
        size: version.Size ?? 0,
        lastModified: version.LastModified?.toISOString() ?? "",
      });
    }
    keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
    versionIdMarker = page.IsTruncated ? page.NextVersionIdMarker : undefined;
  } while (keyMarker || versionIdMarker);

  return rows.sort((a, b) => b.key.localeCompare(a.key));
}

async function download(key, outDir) {
  const s3 = client();
  const bucket = requireEnv("WORKSPACE_STORAGE_BUCKET_NAME", BUCKET);
  await mkdir(outDir, { recursive: true });
  const fileName = key.split("/").pop();
  const outPath = join(outDir, fileName);

  const response = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: key })
  );
  if (!response.Body) {
    throw new Error(`B2 returned no body for ${key}`);
  }
  // The Node S3 client returns a Readable body.
  await pipeline(response.Body, createWriteStream(outPath));

  const info = await stat(outPath);
  console.log(`Downloaded ${key} -> ${outPath} (${info.size} bytes)`);
  return outPath;
}

async function sha256(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

async function verify(zipPath) {
  const manifestPath = zipPath.replace(/\.zip$/, ".manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    throw new Error(
      `Manifest not found at ${manifestPath}. Download the sidecar too, or verify manually.`
    );
  }

  const actual = await sha256(zipPath);
  if (actual !== manifest.sha256) {
    throw new Error(
      `Checksum mismatch: manifest ${manifest.sha256}, file ${actual}. Do not restore this archive.`
    );
  }
  console.log(`Checksum OK (sha256 ${actual})`);
  console.log(`Deployment: ${manifest.deployment}`);
  console.log(`Created: ${manifest.createdAt}`);
  console.log(`Size: ${manifest.sizeBytes} bytes`);
  return manifest;
}

async function main() {
  const key = value("download");

  if (!key) {
    const versions = await listBackupVersions();
    if (versions.length === 0) {
      console.log("No Convex backups found under convex-backups/.");
      return;
    }
    console.log(`Convex backups in ${requireEnv("WORKSPACE_STORAGE_BUCKET_NAME", BUCKET)}:\n`);
    for (const row of versions) {
      console.log(`${row.lastModified}  ${String(row.size).padStart(10)}  ${row.key}`);
    }
    console.log(
      "\nDownload: node scripts/restore-convex-backup.mjs --download <key> --out <dir> --verify"
    );
    return;
  }

  const outDir = value("out");
  if (!outDir) {
    throw new Error("--out <dir> is required with --download");
  }

  const zipPath = await download(key, outDir);
  // Download the sidecar next to the zip so --verify works.
  await download(key.replace(/\.zip$/, ".manifest.json"), outDir);

  if (flag("verify")) {
    await verify(zipPath);
  }

  console.log("\nNext: restore into a FRESH preview deployment, never in place first:");
  console.log(`  npx convex import --deployment <preview-deployment> --replace-all "${zipPath}"`);
  console.log(
    "For a selective production repair, export the single table from the preview and use `--table <name> --append`."
  );
  console.log("Read docs/runbooks/convex-backups.md before touching production.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
