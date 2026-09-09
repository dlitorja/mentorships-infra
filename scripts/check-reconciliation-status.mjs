#!/usr/bin/env node
/**
 * Verify that every row in `instructorProfiles` is reconciled with the
 * matching `instructors` row by slug.
 *
 * Pre-merge gate for PR 4 (drop `instructorProfiles` table). If any profile
 * has overlapping fields that differ from the canonical `instructors` row,
 * deploying PR 4 will lose that data.
 *
 * Implementation: runs `npx convex run --inline-query` per table. The
 * sandboxed query uses `ctx.db.query(table).collect()` to fetch every row
 * without any CLI-side truncation. The earlier `npx convex data` approach
 * silently truncated at the CLI's 100-row default and at any user-supplied
 * `--limit`; an explicit pagination loop with no cursor never advanced
 * past page 1. The server-side `.collect()` call removes both failure modes
 * because it returns all matching documents in a single response.
 *
 * Usage:
 *   node scripts/check-reconciliation-status.mjs --prod
 *   node scripts/check-reconciliation-status.mjs --deployment staging
 *   node scripts/check-reconciliation-status.mjs           # dev (default)
 *
 * Exits 0 if every profile is reconciled, 1 if any divergences are found
 * (or if `instructorProfiles` does not exist yet, which is the desired
 * post-PR 4 state).
 */

import { spawn } from "node:child_process";
import process from "node:process";

const OVERLAPPING_FIELDS = [
  "userId",
  "legacyInstructorRef",
  "email",
  "name",
  "slug",
  "tagline",
  "bio",
  "specialties",
  "background",
  "socials",
  "isActive",
  "isNew",
  "profileImageUrl",
  "profileImageStorageId",
  "profileImageUploadPath",
  "portfolioImages",
  "portfolioImageStorageIds",
];

function parseAcceptDivergenceToken(token) {
  const t = token.trim();
  if (!t) return null;
  const parts = t.split(":");
  if (parts.length === 1) {
    return { kind: "slug", slug: parts[0].trim() };
  }
  if (parts.length === 2) {
    return {
      kind: "field",
      slug: parts[0].trim(),
      field: parts[1].trim(),
      expectedProfileValue: null,
    };
  }
  return {
    kind: "value",
    slug: parts[0].trim(),
    field: parts[1].trim(),
    expectedProfileValue: parts.slice(2).join(":"),
  };
}

function parseArgs(argv) {
  const args = {
    prod: false,
    deployment: null,
    acceptDivergences: [],
    acceptanceFile: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--prod") args.prod = true;
    else if (a === "--deployment") args.deployment = argv[++i];
    else if (a === "--accept-divergences") {
      const csv = argv[++i] || "";
      args.acceptDivergences = csv
        .split(",")
        .map(parseAcceptDivergenceToken)
        .filter(Boolean);
    } else if (a === "--acceptance-file") {
      args.acceptanceFile = argv[++i];
    } else if (a === "-h" || a === "--help") {
      console.log(
        "Usage: node scripts/check-reconciliation-status.mjs [--prod | --deployment <ref>] [--accept-divergences slug1,slug2:field,...] [--acceptance-file <path>]"
      );
      process.exit(0);
    }
  }
  return args;
}

function missingTablePatternsFor(tableName) {
  const escaped = tableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tn = `['"]?${escaped}['"]?`;
  return [
    new RegExp(`Table\\s+${tn}\\s+not found`, "i"),
    new RegExp(`Invalid table name[:\\s]+${escaped}`, "i"),
    new RegExp(`Unknown table\\s+${tn}`, "i"),
    new RegExp(`No table\\s+${tn}\\s+found`, "i"),
  ];
}

function isMissingTableError(combined, tableName) {
  return missingTablePatternsFor(tableName).some((re) => re.test(combined));
}

function runConvexInlineQuery(args, table) {
  const cmdArgs = [
    "convex",
    "run",
    "--inline-query",
    `await ctx.db.query("${table}").collect()`,
  ];
  if (args.prod) cmdArgs.push("--prod");
  else if (args.deployment) cmdArgs.push("--deployment", args.deployment);

  return new Promise((resolve, reject) => {
    const child = spawn("npx", cmdArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("close", (code) => {
      const combined = (stderr || stdout).trim();
      if (code !== 0) {
        if (isMissingTableError(combined, table)) {
          resolve({ missing: true });
          return;
        }
        reject(
          new Error(
            `convex run --inline-query exited ${code}: ${combined.slice(0, 1000)}`
          )
        );
        return;
      }
      const jsonStart = stdout.indexOf("[");
      const jsonEnd = stdout.lastIndexOf("]");
      if (jsonStart === -1 || jsonEnd === -1) {
        reject(
          new Error(
            `Failed to locate JSON array in convex run output: ${combined.slice(0, 500)}`
          )
        );
        return;
      }
      try {
        const parsed = JSON.parse(stdout.slice(jsonStart, jsonEnd + 1));
        resolve({ rows: Array.isArray(parsed) ? parsed : [] });
      } catch (err) {
        reject(
          new Error(
            `Failed to parse convex run output: ${err.message}\nRaw: ${stdout.slice(0, 500)}`
          )
        );
      }
    });
  });
}

function isEmpty(v) {
  if (v === undefined || v === null) return true;
  if (typeof v === "string") return v.length === 0;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (a === undefined || b === undefined) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const aRec = a;
  const bRec = b;
  const ak = Object.keys(aRec).sort();
  const bk = Object.keys(bRec).sort();
  if (ak.length !== bk.length) return false;
  for (let i = 0; i < ak.length; i++) {
    if (ak[i] !== bk[i]) return false;
    if (!deepEqual(aRec[ak[i]], bRec[bk[i]])) return false;
  }
  return true;
}

function diffDirectional(profile, instructor) {
  const dataLoss = [];
  const stale = [];
  const divergent = [];
  for (const field of OVERLAPPING_FIELDS) {
    const pVal = profile[field];
    const iVal = instructor[field];
    if (deepEqual(pVal, iVal)) continue;
    const divergence = { field, profile: pVal, instructor: iVal };
    const profileEmpty = isEmpty(pVal);
    const instructorEmpty = isEmpty(iVal);
    if (profileEmpty && instructorEmpty) continue;
    if (profileEmpty && !instructorEmpty) {
      stale.push(divergence);
    } else if (!profileEmpty && instructorEmpty) {
      dataLoss.push(divergence);
    } else {
      divergent.push(divergence);
    }
  }
  return { dataLoss, stale, divergent };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = args.prod
    ? "prod"
    : args.deployment || "dev";

  console.log(`Reconciliation check (target: ${target})`);
  const accepted = [...args.acceptDivergences];
  if (args.acceptanceFile) {
    try {
      const fs = await import("node:fs/promises");
      const raw = await fs.readFile(args.acceptanceFile, "utf-8");
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        console.error(
          `Acceptance file ${args.acceptanceFile} must be a JSON array of {slug, field, profileValue, reason} objects.`
        );
        process.exit(2);
      }
      for (const entry of parsed) {
        if (
          typeof entry.slug !== "string" ||
          typeof entry.field !== "string"
        ) {
          console.error(
            `Acceptance file entry must have string "slug" and "field". Got: ${JSON.stringify(entry)}`
          );
          process.exit(2);
        }
        accepted.push({
          kind: "value",
          slug: entry.slug,
          field: entry.field,
          expectedProfileValue: entry.profileValue ?? null,
        });
      }
    } catch (err) {
      console.error(
        `Failed to read acceptance file ${args.acceptanceFile}: ${err.message}`
      );
      process.exit(2);
    }
  }
  if (accepted.length > 0) {
    const formatted = accepted
      .map((e) => {
        if (e.kind === "slug") return e.slug;
        if (e.kind === "field") return `${e.slug}:${e.field}`;
        return `${e.slug}:${e.field}:${JSON.stringify(e.expectedProfileValue)}`;
      })
      .join(", ");
    console.log(`Operator override: ${formatted}`);
  }
  console.log("");

  let profilesResult;
  let instructorsResult;
  try {
    [profilesResult, instructorsResult] = await Promise.all([
      runConvexInlineQuery(args, "instructorProfiles"),
      runConvexInlineQuery(args, "instructors"),
    ]);
  } catch (err) {
    console.error(`Failed to read Convex data: ${err.message}`);
    process.exit(2);
  }

  if (profilesResult.missing) {
    console.log(
      "✓ instructorProfiles table not present in this deployment. PR 4 already shipped here."
    );
    console.log("Reconciliation gate: PASS (table gone).");
    process.exit(0);
  }

  const profiles = profilesResult.rows;
  const instructors = instructorsResult.rows;

  console.log(
    `Found ${profiles.length} instructorProfiles row(s), ${instructors.length} instructor row(s).`
  );
  console.log("");

  const instructorBySlug = new Map();
  const duplicateActiveSlugs = [];
  let softDeletedCount = 0;
  for (const inst of instructors) {
    if (inst.deletedAt !== undefined && inst.deletedAt !== null) {
      softDeletedCount += 1;
      continue;
    }
    if (!inst.slug) continue;
    if (instructorBySlug.has(inst.slug)) {
      duplicateActiveSlugs.push(inst.slug);
      continue;
    }
    instructorBySlug.set(inst.slug, inst);
  }

  if (softDeletedCount > 0) {
    console.log(
      `  Skipped ${softDeletedCount} soft-deleted instructor row(s) (deletedAt set).`
    );
  }
  if (duplicateActiveSlugs.length > 0) {
    const uniqueDupes = Array.from(new Set(duplicateActiveSlugs));
    console.error("");
    console.error(
      `✗ ${uniqueDupes.length} slug(s) have multiple ACTIVE instructor rows: ${uniqueDupes.join(", ")}`
    );
    console.error(
      "  The gate cannot determine which row is canonical. Fix the duplicate rows manually before merging PR 4."
    );
    process.exit(1);
  }

  const dataLossBySlug = [];
  const staleBySlug = [];
  const divergentBySlug = [];
  const orphanSlugs = [];
  const noSlugProfiles = [];
  for (const profile of profiles) {
    if (!profile.slug) {
      noSlugProfiles.push(profile._id);
      continue;
    }
    const inst = instructorBySlug.get(profile.slug);
    if (!inst) {
      orphanSlugs.push(profile.slug);
      continue;
    }
    const { dataLoss, stale, divergent } = diffDirectional(profile, inst);
    if (dataLoss.length > 0)
      dataLossBySlug.push({ slug: profile.slug, profileId: profile._id, fields: dataLoss });
    if (stale.length > 0)
      staleBySlug.push({ slug: profile.slug, profileId: profile._id, fields: stale });
    if (divergent.length > 0)
      divergentBySlug.push({
        slug: profile.slug,
        profileId: profile._id,
        fields: divergent,
      });
  }

  function isAccepted(slug, field, profileValue) {
  for (const entry of accepted) {
    if (entry.kind === "slug" && entry.slug === slug) return true;
    if (
      (entry.kind === "field" || entry.kind === "value") &&
      entry.slug === slug &&
      entry.field === field
    ) {
      if (entry.kind === "field") return true;
      if (deepEqual(entry.expectedProfileValue, profileValue)) return true;
    }
  }
  return false;
}

function isSlugAccepted(slug) {
  for (const entry of accepted) {
    if (entry.kind === "slug" && entry.slug === slug) return true;
  }
  return false;
}

const blockingDataLoss = [];
for (const d of dataLossBySlug) {
  const stillBlockingFields = d.fields.filter(
    (f) => !isAccepted(d.slug, f.field, f.profile)
  );
  if (stillBlockingFields.length > 0) {
    blockingDataLoss.push({
      slug: d.slug,
      profileId: d.profileId,
      fields: stillBlockingFields,
    });
  }
}

const blockingDivergent = [];
for (const d of divergentBySlug) {
  const stillBlockingFields = d.fields.filter(
    (f) => !isAccepted(d.slug, f.field, f.profile)
  );
  if (stillBlockingFields.length > 0) {
    blockingDivergent.push({
      slug: d.slug,
      profileId: d.profileId,
      fields: stillBlockingFields,
    });
  }
}

const blockingOrphans = orphanSlugs.filter((s) => !isSlugAccepted(s));

  const totalAcceptedFields =
    dataLossBySlug.reduce(
      (n, d) =>
        n + d.fields.filter((f) => isAccepted(d.slug, f.field, f.profile)).length,
      0
    ) +
    divergentBySlug.reduce(
      (n, d) =>
        n + d.fields.filter((f) => isAccepted(d.slug, f.field, f.profile)).length,
      0
    );
  const totalAcceptedOrphans = orphanSlugs.filter((s) => isSlugAccepted(s)).length;

  const blockingDataLossFieldCount = blockingDataLoss.reduce(
    (n, d) => n + d.fields.length,
    0
  );
  const blockingDivergentFieldCount = blockingDivergent.reduce(
    (n, d) => n + d.fields.length,
    0
  );

  console.log("--- Divergence report ---");
  console.log(
    `DATA_LOSS (profile has data, instructor doesn't): ${dataLossBySlug.length} slug(s), ${dataLossBySlug.reduce((n, d) => n + d.fields.length, 0)} field(s) total (${blockingDataLossFieldCount} field(s) blocking after scoped acceptance)`
  );
  console.log(
    `STALE    (instructor has data, profile doesn't): ${staleBySlug.length} (informational; dropping the profile drops nothing)`
  );
  console.log(
    `DIVERGENT (both have data, schemas/values differ): ${divergentBySlug.length} slug(s), ${divergentBySlug.reduce((n, d) => n + d.fields.length, 0)} field(s) total (${blockingDivergentFieldCount} field(s) blocking after scoped acceptance — both rows have data so dropping one discards it)`
  );
  console.log(
    `ORPHAN   (profile has no matching instructor): ${orphanSlugs.length} (${blockingOrphans.length} blocking after scoped acceptance)`
  );
  console.log("");

  function fieldAcceptedTag(slug, field, profileValue) {
    return isAccepted(slug, field, profileValue) ? " [ACCEPTED]" : "";
  }

  function printDataLoss(label, group) {
    if (group.length === 0) return;
    console.log(`${label}:`);
    for (const item of group) {
      console.log(`  - slug=${item.slug}`);
      for (const f of item.fields) {
        console.log(
          `      ${f.field}${fieldAcceptedTag(item.slug, f.field, f.profile)}: profile=${JSON.stringify(f.profile)} | instructor=${JSON.stringify(f.instructor)}`
        );
      }
    }
    console.log("");
  }

  function printStandardGroup(label, group) {
    if (group.length === 0) return;
    console.log(`${label}:`);
    for (const item of group) {
      console.log(`  - slug=${item.slug}`);
      for (const f of item.fields) {
        console.log(
          `      ${f.field}: profile=${JSON.stringify(f.profile)} | instructor=${JSON.stringify(f.instructor)}`
        );
      }
    }
    console.log("");
  }

  if (dataLossBySlug.length > 0) {
    printDataLoss("DATA_LOSS (profile → instructor)", dataLossBySlug);
  }
  if (staleBySlug.length > 0) {
    printStandardGroup("STALE (instructor already has the data; profile is stale)", staleBySlug);
  }
  if (divergentBySlug.length > 0) {
    printStandardGroup("DIVERGENT (both have data, instructor is canonical)", divergentBySlug);
  }

  if (orphanSlugs.length > 0) {
    console.log("ORPHAN (profile has no matching instructor by slug):");
    for (const slug of orphanSlugs) {
      console.log(`  - ${slug}${isSlugAccepted(slug) ? " [ACCEPTED]" : ""}`);
    }
    console.log("");
  }

  if (noSlugProfiles.length > 0) {
    console.log(`✗ ${noSlugProfiles.length} instructorProfiles row(s) have no slug.`);
  }

  if (
    blockingDataLoss.length === 0 &&
    blockingDivergent.length === 0 &&
    blockingOrphans.length === 0 &&
    noSlugProfiles.length === 0
  ) {
    console.log("Reconciliation gate: PASS.");
    if (accepted.length > 0) {
      console.log(
        `  (${totalAcceptedFields} DATA_LOSS+DIVERGENT field(s) + ${totalAcceptedOrphans} orphan slug(s) accepted via --accept-divergences)`
      );
    }
    process.exit(0);
  }

  console.error("Reconciliation gate: FAIL.");
  if (blockingDataLoss.length > 0) {
    console.error(
      `  - ${blockingDataLoss.length} DATA_LOSS divergence(s) not accepted. Pass --accept-divergences <slug>:<field> after manual review.`
    );
    for (const d of blockingDataLoss)
      for (const f of d.fields) console.error(`      • ${d.slug}:${f.field}`);
  }
  if (blockingDivergent.length > 0) {
    console.error(
      `  - ${blockingDivergent.length} DIVERGENT field(s) not accepted. Both rows have data so dropping one discards it. Pass --accept-divergences <slug>:<field> after manual review.`
    );
    for (const d of blockingDivergent)
      for (const f of d.fields) console.error(`      • ${d.slug}:${f.field}`);
  }
  if (blockingOrphans.length > 0) {
    console.error(
      `  - ${blockingOrphans.length} orphan slug(s) not accepted. Re-seed instructors first.`
    );
    for (const s of blockingOrphans) console.error(`      • ${s}`);
  }
  if (noSlugProfiles.length > 0) {
    console.error(
      `  - ${noSlugProfiles.length} profile row(s) have no slug. Fix data integrity first.`
    );
  }
  process.exit(1);
}

main();
