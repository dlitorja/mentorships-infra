#!/usr/bin/env node
/**
 * Convex Route Mapping reporter (HUC-94, second prong).
 *
 * For each route.ts file under apps/platform/app/api/onboarding (recursive
 * glob), this script finds the Convex calls inside the route handlers
 * and extracts:
 *
 *   1. The Convex reference path (`api.<module>.<function>`).
 *   2. The keys of the args object passed to that mutation/action.
 *   3. The declared args on the matching Convex function
 *      (`convex/<module>.ts`).
 *
 * It then prints a Markdown table per route showing what was sent
 * vs what is declared. Today this is informational; tightening into a
 * CI gate (Zod-shape diff, optional vs required, type match) is a
 * future PR. The point of shipping this NOW is to give reviewers +
 * future PR authors a single-command lookup for the route ↔ Convex
 * seam.
 *
 * Usage:
 *   node scripts/convex-route-mapping.mjs
 *   pnpm exec tsx scripts/convex-route-mapping.mjs
 *
 * Exit code is always 0 today (reporter only). When the conformance
 * check tightens into a CI gate, the exit code will reflect drift
 * (non-zero on mismatch).
 */
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const ROUTE_DIR = join(ROOT, "apps/platform/app/api/onboarding");
const CONVEX_DIR = join(ROOT, "convex");

/**
 * Read a TypeScript source file as text, return its content.
 */
async function readSource(absPath) {
  return await readFile(absPath, "utf8");
}

/**
 * List `route.ts` files under the API directory. We only descend
 * one or two levels deep (the onboarding routes are all under
 * `[id]/...`).
 */
async function findRouteFiles(dir) {
  const out = [];
  async function walk(d, depth = 0) {
    if (depth > 4) return;
    const entries = await readdir(d, { withFileTypes: true });
    for (const entry of entries) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) {
        await walk(p, depth + 1);
      } else if (entry.isFile() && entry.name === "route.ts") {
        out.push(p);
      }
    }
  }
  await walk(dir);
  return out;
}

/**
 * Find every Convex call site (`convex.<query|mutation|action>(ref, { ... })`)
 * inside a route source file and return each call's reference path +
 * the top-level keys of the args object.
 *
 * Phase 1 is loose: regex-based. Phase 2 (future) should use the TS
 * compiler API to get type-accurate extraction.
 */
function extractConvexCalls(source) {
  const calls = [];
  // Match:
  //   await convex.<verb>(
  //     (api as any).<module>.<function>,
  //     {
  //       key: ...,
  //       ...
  //     } as any
  //   );
  // We tolerate multi-line args bodies.
  const callRegex =
    /convex\.(query|mutation|action)\s*\(\s*\(\s*api\s+as\s+any\s*\)\.(\w+)\.(\w+)\s*,/g;
  // The args object starts at the next `{` after the reference and
  // we capture till the matching `}` (ignoring nested braces).
  let match;
  while ((match = callRegex.exec(source)) !== null) {
    const verb = match[1];
    const moduleName = match[2];
    const fnName = match[3];
    // Find the args object — start at the next `{` after the
    // reference arg.
    const afterRef = match.index + match[0].length;
    let i = afterRef;
    while (i < source.length && source[i] !== "{") i++;
    if (i >= source.length) {
      calls.push({ verb, moduleName, fnName, argsKeys: [] });
      continue;
    }
    // Find matching close brace at the same nesting level.
    let depth = 0;
    let start = i;
    let end = -1;
    for (; i < source.length; i++) {
      const ch = source[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const argsBody = end > 0 ? source.slice(start, end + 1) : "";
    // Extract top-level keys: lines of the form `key:` at indent 2.
    const keyRegex = /^\s{2,}"?(\w+)"?\s*:/gm;
    const keys = [];
    let km;
    while ((km = keyRegex.exec(argsBody)) !== null) {
      keys.push(km[1]);
    }
    calls.push({ verb, moduleName, fnName, argsKeys: keys });
  }
  return calls;
}

/**
 * Find the declared `args: { ... }` block for a function in a
 * Convex source file. Loosely matches lines like
 *   `export const foo = <verb>({` or `export const foo = <verb>({ ... }, async`
 * followed by the `args: { ... }` block, then the function body.
 *
 * Returns the keys of the declared args.
 */
function extractConvexArgs(source, functionName) {
  // Find the function header.
  const fnRegex = new RegExp(
    `export const ${functionName}\\s*=\\s*\\w+\\(\\s*\\{`,
    "g"
  );
  const headerMatch = fnRegex.exec(source);
  if (!headerMatch) return null;
  // From there, find the matching `})`; then look for `args:` either
  // before `returns:` or in the first object.
  const body = source.slice(headerMatch.index);
  // We look for the first `args:` followed by `{`, capture keys until
  // matching `}`.
  const argsOpen = body.indexOf("args:");
  if (argsOpen < 0) return null;
  // Find the `{` immediately after `args:`.
  let start = argsOpen + 5;
  while (start < body.length && body[start] !== "{") start++;
  if (start >= body.length) return null;
  let depth = 0;
  let end = -1;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const argsBody = end > 0 ? body.slice(start, end + 1) : "";
  const keyRegex = /^\s*"?(\w+)"?\??:\s*[v\[\(]/gm;
  const keys = [];
  let km;
  while ((km = keyRegex.exec(argsBody)) !== null) {
    keys.push(km[1]);
  }
  return keys;
}

/**
 * Resolve the Convex module file path. The api stub in the route uses
 * `onboardingQuestionnaire` → `convex/onboardingQuestionnaire.ts`,
 * and `onboardingWorkExamples` → `convex/onboardingWorkExamples.ts`.
 * Actions live in `convex/<module>Actions.ts`.
 */
function resolveConvexFile(moduleName) {
  const candidates = [
    join(CONVEX_DIR, `${moduleName}.ts`),
    join(CONVEX_DIR, `${moduleName}Actions.ts`),
  ];
  return candidates;
}

async function main() {
  const routeFiles = await findRouteFiles(ROUTE_DIR);
  routeFiles.sort();
  console.log(
    `# Convex Route Mapping (HUC-94)\n\nGenerated from \`scripts/convex-route-mapping.mjs\`.\n`
  );
  for (const routeAbs of routeFiles) {
    const source = await readSource(routeAbs);
    const calls = extractConvexCalls(source);
    if (calls.length === 0) continue;
    const routePath = relative(ROOT, routeAbs);
    console.log(`## ${routePath}\n`);
    console.log("| verb | Convex reference | args sent (route) | args declared |");
    console.log("|------|------------------|-------------------|---------------|");
    for (const call of calls) {
      const refPath = `${call.moduleName}:${call.fnName}`;
      const sent = call.argsKeys.length
        ? call.argsKeys.map((k) => `\`${k}\``).join(", ")
        : "_(none)_";
      let declared = "_(not found)_";
      for (const candidate of resolveConvexFile(call.moduleName)) {
        try {
          const convexSource = await readSource(candidate);
          const declKeys = extractConvexArgs(convexSource, call.fnName);
          if (declKeys) {
            declared = declKeys.map((k) => `\`${k}\``).join(", ");
            break;
          }
        } catch {
          // Try next candidate.
        }
      }
      console.log(
        `| \`${call.verb}\` | \`${refPath}\` | ${sent} | ${declared} |`
      );
    }
    console.log("");
  }
  console.log(
    "_This is a reporter. Tighten into a CI gate (Zod shape, optional vs required, type match) in a follow-up PR._"
  );
}

main().catch((err) => {
  console.error("conformance reporter failed:", err);
  process.exit(1);
});
