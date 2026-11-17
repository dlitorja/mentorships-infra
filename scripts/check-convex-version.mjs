#!/usr/bin/env node
/**
 * Guard the workspace's `convex` dependency floor and alignment.
 *
 * Why this exists:
 *
 *  1. Security. `convex@1.32.0–1.47.x` is affected by GHSA-qw8j-4xj7-6f28
 *     (High: RCE on the developer's machine via a malicious site visited while
 *     `npx convex dev` runs in anonymous mode — which the agent skills under
 *     `.agents/skills/` recommend) and GHSA-9mw5-7p28-rvv4 (Moderate: code
 *     execution / file deletion from an untrusted project checkout). Both are
 *     fixed in 1.48.0.
 *  2. Alignment. `convex@1.46.0` changed validator TypeScript compatibility
 *     ("projects sharing validators across packages may need to align their
 *     convex dependency versions"), and 1.47/1.49 widen that surface. The
 *     workspace resolved 1.43 / 1.45 / 1.46 simultaneously before PR #1055,
 *     so a copy-pasted app `package.json` is a realistic regression path.
 *
 * Checks performed:
 *  1. Every workspace that declares `convex` must declare a single-clause range
 *     whose floor is >= MIN_VERSION. Ranges this script cannot verify (unions,
 *     `<`, `*`, `x`, hyphen ranges, `workspace:*`) fail rather than pass, since a
 *     floor guessed from the first number in a union can allow older versions.
 *  2. All workspaces must declare the same range, and must actually resolve the
 *     same installed version — equal range strings alone do not guarantee one
 *     copy after a filtered `pnpm update`.
 *  3. The version each workspace resolves must be >= MIN_VERSION, which catches
 *     a stale lockfile even when the declared ranges look correct.
 *
 * Usage:
 *   node scripts/check-convex-version.mjs
 *   node scripts/check-convex-version.mjs --root /path/to/repo   # for testing
 *
 * Exits 0 when clean, 1 on any violation.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const MIN_VERSION = "1.48.0";
const MIN = MIN_VERSION.split(".").map(Number);

const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = { root: SCRIPT_ROOT };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--root") {
      const value = argv[i + 1];
      if (!value) throw new Error("--root requires a directory argument");
      args.root = resolve(value);
      i += 1;
    } else if (argv[i] === "--help" || argv[i] === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  return args;
}

/**
 * Extract the lowest version the range can resolve to.
 *
 * Only single-clause ranges are accepted (`^1.50.0`, `~1.50.0`, `>=1.50.0`,
 * `=1.50.0`, `1.50.0`). Anything else — `||` unions, `<`, `*`, `1.x`, hyphen
 * ranges, `workspace:*`, git URLs — is rejected rather than guessed at, because
 * a floor read from the first number in a union (`^1.50.0 || ^1.43.0`) would
 * wrongly pass. Callers report `null` as a failure, not a warning.
 */
function rangeFloor(range) {
  const match = /^\s*(\^|~|>=|=)?\s*(\d+)\.(\d+)\.(\d+)\s*$/.exec(range);
  if (!match) return null;
  return [Number(match[2]), Number(match[3]), Number(match[4])];
}

/**
 * Resolve the installed `convex` version visible from a workspace directory, the
 * same way Node would resolve it at runtime (pnpm links the workspace's own
 * copy). Returns null when dependencies are not installed.
 */
function installedVersionFor(root, workspaceDir) {
  try {
    const require = createRequire(join(root, workspaceDir, "package.json"));
    const manifest = require.resolve("convex/package.json");
    return JSON.parse(readFileSync(manifest, "utf8")).version;
  } catch {
    return null;
  }
}

function compare(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function listWorkspaceManifests(root) {
  const manifests = [{ dir: ".", file: join(root, "package.json") }];
  for (const group of ["apps", "packages"]) {
    const groupDir = join(root, group);
    if (!existsSync(groupDir)) continue;
    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = join(groupDir, entry.name, "package.json");
      if (existsSync(file)) {
        manifests.push({ dir: `${group}/${entry.name}`, file });
      }
    }
  }
  return manifests;
}

function readDeclarations(manifest) {
  const json = JSON.parse(readFileSync(manifest.file, "utf8"));
  const declarations = [];
  for (const field of ["dependencies", "devDependencies"]) {
    const range = json[field]?.convex;
    if (typeof range === "string") {
      declarations.push({ workspace: manifest.dir, field, range });
    }
  }
  return declarations;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(__doc__());
    return 0;
  }

  const errors = [];
  const warnings = [];
  const declarations = [];

  for (const manifest of listWorkspaceManifests(args.root)) {
    declarations.push(...readDeclarations(manifest));
  }

  if (declarations.length === 0) {
    errors.push(`No workspace declares a "convex" dependency under ${args.root}`);
  }

  const distinctRanges = new Set();
  const installedByWorkspace = new Map();

  for (const declaration of declarations) {
    const floor = rangeFloor(declaration.range);
    distinctRanges.add(declaration.range);

    if (floor === null) {
      errors.push(
        `${declaration.workspace} declares convex "${declaration.range}", which this check cannot verify. Declare a single caret range (e.g. "^${MIN_VERSION}"); unions, "<", "*", "x" and hyphen ranges are rejected because they can allow versions below the floor.`
      );
      continue;
    }

    if (compare(floor, MIN) < 0) {
      errors.push(
        `${declaration.workspace} (${declaration.field}) declares convex "${declaration.range}", whose floor ${floor.join(".")} is below ${MIN_VERSION} (security fixes GHSA-qw8j-4xj7-6f28 / GHSA-9mw5-7p28-rvv4)`
      );
    }

    const installed = installedVersionFor(args.root, declaration.workspace);
    if (installed !== null) {
      installedByWorkspace.set(declaration.workspace, installed);
    }
  }

  if (distinctRanges.size > 1) {
    errors.push(
      `Exactly one convex range must be declared workspace-wide; found ${[...distinctRanges].sort().join(", ")} (mixed versions break shared validator typings and install duplicate copies)`
    );
  }

  // Equal range strings do not guarantee equal installed versions — a filtered
  // `pnpm update convex --filter <app>` can leave one workspace on a newer copy.
  // Compare what each declaring workspace actually resolves.
  if (installedByWorkspace.size > 0) {
    const distinctInstalled = new Set(installedByWorkspace.values());
    if (distinctInstalled.size > 1) {
      const detail = [...installedByWorkspace.entries()]
        .map(([workspace, version]) => `${workspace} -> ${version}`)
        .join(", ");
      errors.push(
        `Workspaces resolve different convex versions (${detail}). Run \`pnpm install\` from the repo root so pnpm dedupes to one copy.`
      );
    }

    for (const [workspace, version] of installedByWorkspace) {
      const installed = rangeFloor(version);
      if (installed === null) {
        warnings.push(`Could not parse installed convex version "${version}" in ${workspace}`);
      } else if (compare(installed, MIN) < 0) {
        errors.push(
          `${workspace} resolves convex ${version}, below ${MIN_VERSION}. Run \`pnpm install\` — or rebase onto main first if this checkout's lockfile still pins an older version.`
        );
      }
    }
  } else {
    warnings.push(
      "node_modules/convex not found; skipped the installed-version check (expected when dependencies are not installed)"
    );
  }

  for (const warning of warnings) {
    console.warn(`warning: ${warning}`);
  }

  if (errors.length > 0) {
    console.error(`\nconvex version check failed (floor ${MIN_VERSION}):\n`);
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    console.error("");
    return 1;
  }

  console.log(
    `convex version check passed: ${declarations.length} declaration(s), floor >= ${MIN_VERSION}, single range.`
  );
  return 0;
}

function __doc__() {
  return [
    "Usage: node scripts/check-convex-version.mjs [--root <dir>]",
    "",
    `Fails when any workspace declares a convex range below ${MIN_VERSION}, when`,
    "workspaces disagree on the range, or when the installed copy is below the floor.",
  ].join("\n");
}

process.exitCode = main();
