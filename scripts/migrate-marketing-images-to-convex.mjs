#!/usr/bin/env node
// Sync instructor images from apps/marketing/public/instructors to Convex Storage
// and update instructor documents to point at Convex URLs.

import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// repo root = one directory up from /scripts
const REPO_ROOT = join(__dirname, "..");

const MARKETING_INSTRUCTORS_DIR = join(REPO_ROOT, "apps", "marketing", "public", "instructors");

const CONVEX_URL = (process.env.NEXT_PUBLIC_CONVEX_URL || "").replace(/\/+$/g, "");
if (!CONVEX_URL) {
  console.error("ERROR: NEXT_PUBLIC_CONVEX_URL env var is required.");
  process.exit(1);
}

function contentTypeFor(ext) {
  switch (ext.toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

function listSlugDirs() {
  const entries = readdirSync(MARKETING_INSTRUCTORS_DIR, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

function collectImagesForSlug(slug) {
  const dir = join(MARKETING_INSTRUCTORS_DIR, slug);
  const files = readdirSync(dir).filter((f) => statSafe(join(dir, f))?.isFile());

  const profile = files.find((f) => /^profile\.(jpe?g|png|svg)$/i.test(f)) || null;
  const works = files
    .map((f) => {
      const m = /^work-(\d+)\.(jpe?g|png|svg)$/i.exec(f);
      if (!m) return null;
      return { index: Number(m[1]), name: f };
    })
    .filter(Boolean)
    .sort((a, b) => a.index - b.index)
    .map((x) => x.name);
  return { dir, profile, works };
}

function statSafe(path) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

async function uploadFileToConvex(convex, filePath) {
  const ext = extname(filePath);
  const ctype = contentTypeFor(ext);
  const uploadUrl = await convex.mutation(api.instructors.generateInstructorUploadUrl, {});

  const data = readFileSync(filePath);
  const blob = new Blob([data], { type: ctype });

  // Convex Storage expects a raw POST body with Content-Type matching the file
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": ctype },
    body: blob,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Upload failed (${res.status}): ${text}`);
  }
  const json = await res.json();
  if (!json?.storageId) throw new Error("Missing storageId from upload response");
  return { storageId: json.storageId, contentType: ctype };
}

async function main() {
  const convex = new ConvexHttpClient(CONVEX_URL);

  // Fetch public instructors (exposes _id and slug)
  const publicInstructors = await convex.query(api.instructors.getPublicInstructors, {});
  const bySlug = new Map(publicInstructors.map((i) => [i.slug, i]));

  const slugs = listSlugDirs();
  const results = [];

  for (const slug of slugs) {
    const mapping = collectImagesForSlug(slug);
    const found = bySlug.get(slug);
    if (!found) {
      results.push({ slug, status: "skip:missing-instructor" });
      continue;
    }

    const instructorId = found._id;
    let updated = false;
    let skipped = false;
    try {
      // Profile image
      if (mapping.profile) {
        if (found.profileImageStorageId) {
          skipped = true;
        } else {
          const pf = join(mapping.dir, mapping.profile);
          const { storageId, contentType } = await uploadFileToConvex(convex, pf);
          await convex.mutation(api.instructors.uploadInstructorProfileImage, {
            instructorId,
            storageId,
            contentType,
          });
          updated = true;
        }
      }

      // Portfolio images
      // Only treat Convex storage IDs as existing. Legacy URLs in portfolioImages
      // should not prevent migration to Storage.
      const existingIds = Array.isArray(found.portfolioImageStorageIds)
        ? found.portfolioImageStorageIds
        : [];

      for (let i = 0; i < mapping.works.length; i++) {
        const already = existingIds[i];
        if (already) {
          skipped = true;
          continue;
        }
        const wf = join(mapping.dir, mapping.works[i]);
        const { storageId, contentType } = await uploadFileToConvex(convex, wf);
        await convex.mutation(api.instructors.uploadInstructorPortfolioImage, {
          instructorId,
          storageId,
          contentType,
          index: i,
        });
        updated = true;
      }

      const status = updated && skipped ? "partial" : updated ? "updated" : skipped ? "skipped" : "noop";
      results.push({ slug, status });
    } catch (e) {
      results.push({ slug, status: "error", error: e?.message || String(e) });
    }
  }

  const summary = results.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    },
    {}
  );

  console.log("Migration summary:", summary);
  const errors = results.filter((x) => x.status === "error");
  for (const r of errors) {
    console.log(` - ${r.slug}: ${r.error}`);
  }
  if (errors.length > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
