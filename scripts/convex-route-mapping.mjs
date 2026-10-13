#!/usr/bin/env node
/**
 * Convex Route Mapping reporter (HUC-94, second prong).
 *
 * For each route.ts file under apps/platform/app/api/onboarding
 * (recursive walk), this script finds the Convex calls inside the
 * route handlers and extracts:
 *
 *   1. The Convex reference path (`api.<module>.<function>`).
 *   2. The TOP-LEVEL keys of the args object passed to that
 *      mutation / action / query.
 *   3. The TOP-LEVEL declared args on the matching Convex function
 *      in `convex/<module>.ts`.
 *
 * Why top-level only? Greptile P1 history on the Zod ↔ Convex seam
 * is dominated by drift between the route's literal args and the
 * declared validator shape. Nested shape (e.g. an `answers`
 * array) is reported as a single key — its inner conformance is
 * JSON-schema territory and belongs in a follow-up CI gate.
 *
 * Today's script is a reporter only — it prints a Markdown table
 * and exits 0. Tightening into a CI gate (Zod shape, optional vs
 * required, type match, returning exit code 1 on drift) is a
 * follow-up PR.
 *
 * Usage:
 *   node scripts/convex-route-mapping.mjs
 *   pnpm route-mapping
 */
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const ROUTE_DIR = join(ROOT, "apps/platform/app/api/onboarding");
const CONVEX_DIR = join(ROOT, "convex");

async function findRouteFiles(dir) {
  const out = [];
  async function walk(d, depth = 0) {
    if (depth > 4) return;
    const entries = await readdir(d, { withFileTypes: true });
    for (const entry of entries) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) await walk(p, depth + 1);
      else if (entry.isFile() && entry.name === "route.ts") out.push(p);
    }
  }
  await walk(dir);
  return out;
}

function extractConvexCalls(source) {
  const calls = [];
  const callRegex =
    /convex\.(query|mutation|action)\s*\(\s*\(\s*api\s+as\s+any\s*\)\.(\w+)\.(\w+)\s*,/g;
  let m;
  while ((m = callRegex.exec(source)) !== null) {
    const verb = m[1];
    const moduleName = m[2];
    const fnName = m[3];
    // Find the args object literal — first balanced `{ ... }` after
    // the reference arg, at top nesting.
    const afterRef = m.index + m[0].length;
    let i = afterRef;
    while (i < source.length && source[i] !== "{") i++;
    if (i >= source.length) {
      calls.push({ verb, moduleName, fnName, argsKeys: [] });
      continue;
    }
    const openIdx = i;
    let depth = 0;
    let closeIdx = -1;
    for (; i < source.length; i++) {
      const ch = source[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          closeIdx = i;
          break;
        }
      }
    }
    // Body INCLUDES the outer `{` and `}` — the parser below uses
    // them to detect end-of-body (so it works for shorthand like
    // `{ onboardingId }` whose body would otherwise be just
    // ` onboardingId ` with no closing brace).
    const argsBody =
      closeIdx > 0 ? source.slice(openIdx, closeIdx + 1) : "";
    calls.push({
      verb,
      moduleName,
      fnName,
      argsKeys: parseTopLevelKeys(argsBody),
    });
  }
  return calls;
}

/**
 * Parse an args object literal (INCLUDING its outer `{ ... }`) and
 * return the top-level keys.
 *
 * Why "including"? Two reasons:
 *   1. The matching `}` is what tells the parser when to stop.
 *      Without it, a shorthand `{ onboardingId }` reduces to
 *      ` onboardingId ` — no terminator — and the parser returns []
 *      even though the key is obvious.
 *   2. Tracking brace from 0 → 1 at the first `{` and back to 0
 *      at the matching `}` mirrors a JS tokenizer, so the parser
 *      can confidently report "top-level keys = identifiers at
 *      brace === 1".
 *
 * Line comments (`// ... \n`) suppress string-walking — without
 * that guard, an apostrophe like `the client's` is mistaken for a
 * JS string delimiter and walks straight to the next `'`, skipping
 * every key on the way (Greptile P2 #4).
 *
 * Paren / bracket are tracked so a `,` inside `answers.map(...)`
 * or inside an `[]` array doesn't accidentally trigger the
 * VALUE → KEY transition. They are clamped to non-negative so a
 * stray `)` inside a `// ...` comment doesn't deadlock us.
 */
function parseTopLevelKeys(body) {
  const keys = [];
  let brace = 0;
  let paren = 0;
  let bracket = 0;
  let state = "KEY";
  let inLineComment = false;
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      i++;
      continue;
    }
    if (ch === "/" && body[i + 1] === "/") {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (state !== "KEY" && /\s/.test(ch)) { i++; continue; }
    if (ch === "{") { brace++; i++; continue; }
    if (ch === "}") {
      brace--;
      i++;
      if (brace < 0) return keys;
      if (brace === 0) return keys;
      continue;
    }
    if (ch === "(") { paren++; i++; continue; }
    if (ch === ")") { paren = Math.max(0, paren - 1); i++; continue; }
    if (ch === "[") { bracket++; i++; continue; }
    if (ch === "]") { bracket = Math.max(0, bracket - 1); i++; continue; }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < body.length && body[i] !== quote) {
        if (body[i] === "\\") i++;
        i++;
      }
      i++;
      continue;
    }
    if (state === "KEY") {
      if (/\s/.test(ch)) { i++; continue; }
      if (ch === ",") { i++; continue; }
      if (/[a-zA-Z_$]/.test(ch)) {
        const start = i;
        while (i < body.length && /[\w$]/.test(body[i])) i++;
        const ident = body.slice(start, i);
        let look = i;
        while (look < body.length && /\s/.test(body[look])) look++;
        const next = body[look] ?? "";
        if (next === ":") {
          keys.push(ident);
          state = "VALUE";
          i = look + 1;
          continue;
        }
        if (next === "?") {
          look++;
          while (look < body.length && /\s/.test(body[look])) look++;
          if (body[look] === ":") {
            keys.push(ident);
            state = "VALUE";
            i = look + 1;
            continue;
          }
        }
        if (next === "," || next === "}") {
          keys.push(ident);
          i = look;
          if (next === ",") i++;
          state = "KEY";
          continue;
        }
        continue;
      }
      i++; continue;
    }
    if (
      ch === "," &&
      brace === 1 &&
      paren === 0 &&
      bracket === 0
    ) {
      state = "KEY";
      i++;
      continue;
    }
    i++;
  }
  return keys;
}

function extractConvexArgs(source, functionName) {
  const fnRegex = new RegExp(
    `export const ${functionName}\\s*=\\s*\\w+\\(\\s*\\{`,
    "g"
  );
  const headerMatch = fnRegex.exec(source);
  if (!headerMatch) return null;
  const body = source.slice(headerMatch.index);
  const argsOpen = body.indexOf("args:");
  if (argsOpen < 0) return null;
  let searchFrom = argsOpen + "args:".length;
  while (searchFrom < body.length && body[searchFrom] !== "{") searchFrom++;
  if (searchFrom >= body.length) return null;
  let depth = 0;
  let end = -1;
  for (let i = searchFrom; i < body.length; i++) {
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
  if (end < 0) return null;
  // Include the outer `{` and `}` so the parser can detect end-of-args.
  const argsBody = body.slice(searchFrom, end + 1);
  return parseTopLevelKeys(argsBody);
}

function resolveConvexFile(moduleName) {
  return [
    join(CONVEX_DIR, `${moduleName}.ts`),
    join(CONVEX_DIR, `${moduleName}Actions.ts`),
  ];
}

async function main() {
  const routeFiles = await findRouteFiles(ROUTE_DIR);
  routeFiles.sort();
  console.log(
    `# Convex Route Mapping (HUC-94)\n\nGenerated from \`scripts/convex-route-mapping.mjs\`.\n`
  );
  for (const routeAbs of routeFiles) {
    const source = await readFile(routeAbs, "utf8");
    const calls = extractConvexCalls(source);
    if (calls.length === 0) continue;
    const routePath = relative(ROOT, routeAbs);
    console.log(`## ${routePath}\n`);
    console.log("| verb | Convex reference | args sent (route) | args declared |");
    console.log("|------|------------------|-------------------|---------------|");
    for (const call of calls) {
      const refPath = `${call.moduleName}:${call.fnName}`;
      const sent =
        call.argsKeys.length > 0
          ? call.argsKeys.map((k) => `\`${k}\``).join(", ")
          : "_(none)_";
      let declared = "_(not found)_";
      for (const candidate of resolveConvexFile(call.moduleName)) {
        try {
          const convexSource = await readFile(candidate, "utf8");
          const declKeys = extractConvexArgs(convexSource, call.fnName);
          if (declKeys) {
            declared = declKeys.map((k) => `\`${k}\``).join(", ");
            break;
          }
        } catch {
          // Next candidate.
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
