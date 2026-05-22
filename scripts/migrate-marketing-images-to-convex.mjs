#!/usr/bin/env node
// Sync instructor images from apps/marketing/public/instructors to Convex Storage
// and update instructor documents to point at Convex URLs.

import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, "..", "..");

const MARKETING_INSTRUCTORS_DIR = join(__dirname, "apps", "marketing", "public", "instructors");

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
  const form = new FormData();
  form.append("file", blob, filePath.split("/").pop());

  const res = await fetch(uploadUrl, { method: "POST", body: form });
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
    try {
      // Profile image
      if (mapping.profile) {
        const pf = join(mapping.dir, mapping.profile);
        const { storageId, contentType } = await uploadFileToConvex(convex, pf);
        await convex.mutation(api.instructors.uploadInstructorProfileImage, {
          instructorId,
          storageId,
          contentType,
        });
        updated = true;
      }

      // Portfolio images
      for (let i = 0; i < mapping.works.length; i++) {
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

      results.push({ slug, status: updated ? "updated" : "noop" });
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
  for (const r of results.filter((x) => x.status === "error")) {
    console.log(` - ${r.slug}: ${r.error}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
