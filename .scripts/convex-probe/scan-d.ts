#!/usr/bin/env -S npx tsx
/* eslint-disable */
// scan-d.ts — no-auth writable operations scanner.
//
// History: derived from the security-audit pilot at commit 9fbf1794
// (`/tmp/opencode/sec-pilot/scan-noauth.ts` at pilot time). The hard-coded
// `ROOT` and `/tmp/opencode/sec-pilot/` output path have been removed
// to make this script portable across local dev, CI, and other
// checkouts. Detection logic and helper whitelist are unchanged.

import { mkdirSync, readFileSync, statSync, readdirSync, writeFileSync } from "node:fs";
import { relative } from "node:path";

// CONVEX_DIR is supplied as the first positional CLI argument; defaults
// to `./convex` for local invocation from repo root. On CI, the workflow
// sets it to `../../convex` (relative to `.scripts/convex-probe/`).
const CONVEX_DIR = process.argv[2] ?? "./convex";

if (!CONVEX_DIR) {
  console.error("usage: tsx scan-d.ts <convex-dir>");
  console.error("  default: ./convex");
  process.exit(2);
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir)) {
    const p = `${dir}/${ent}`;
    const s = statSync(p);
    if (s.isDirectory()) {
      if (ent === "_generated") continue;
      out.push(...walk(p));
    } else if (p.endsWith(".ts") && !p.endsWith(".d.ts") && !p.endsWith(".test.ts")) {
      out.push(p);
    }
  }
  return out;
}

const files = walk(CONVEX_DIR);

type Fn = {
  name: string;
  startLine: number;
  headerLine: number;
  body: string;
  bodyStart: number;
  bodyEnd: number;
  file: string;
  type: string;
  isPublic: boolean;
};

function matchPublicFunction(src: string): Fn[] {
  const funcs: Fn[] = [];
  const re = /export const (\w+)\s*=\s*(query|mutation|action|internalQuery|internalMutation|internalAction)\(/g;
  let m;
  while ((m = re.exec(src))) {
    const name = m[1];
    const kind = m[2] as any;
    const isPublic = !kind.startsWith("internal") && kind !== "action";
    let i = m.index + m[0].length;
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] !== "{") continue;
    const openBrace = i;
    let depth = 0;
    let j = openBrace;
    while (j < src.length) {
      const ch = src[j];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) break;
      } else if (ch === '"' || ch === "'" || ch === "`") {
        j++;
        while (j < src.length && src[j] !== ch) {
          if (src[j] === "\\") j++;
          j++;
        }
      } else if (ch === "/" && src[j + 1] === "/") {
        while (j < src.length && src[j] !== "\n") j++;
      } else if (ch === "/" && src[j + 1] === "*") {
        j += 2;
        while (j < src.length && !(src[j] === "*" && src[j + 1] === "/")) j++;
        j++;
      }
      j++;
    }
    funcs.push({
      name,
      startLine: src.slice(0, m.index).split("\n").length,
      headerLine: src.slice(0, m.index + m[0].length).split("\n").length,
      body: src.slice(openBrace, j + 1),
      bodyStart: openBrace,
      bodyEnd: j + 1,
      file: "",
      type: kind,
      isPublic,
    });
  }
  return funcs;
}

function lineAt(src: string, offset: number): number {
  return src.slice(0, offset).split("\n").length;
}

function hasAuthCheck(body: string): boolean {
  if (/\bctx\.auth\b/.test(body)) return true;
  const whitelist = [
    "getUserIdentity", "requireIdentity", "requireIdentityForMutation",
    "requireRole", "requireOwner", "assertOwner", "assertRole", "getIdentity",
    "getAuthedIdentity", "getCurrentUser", "requireUser", "requireCaller",
    "requireAdminUser", "requireStaffRole", "requireAdmin", "requireAdminOrSupport",
    "requireAdminOrSelfVideoEditor", "isStaffCaller", "isAdmin", "isAdminUser",
    "lookupStaffRole", "ensureAssignedStudent", "canViewSubmission",
    "canViewOnboarding", "detectRenewal",
    "assertParticipantForSession", "assertParticipant", "assertWorkspaceParticipant",
    "assertSessionBelongsToWorkspace", "assertB2FileUploadOwnedByCaller",
    "assertResourceBelongsToInstructor", "assertCanModifySessionPack",
    "getWorkspaceRole", "getCallerWorkspaceRole", "requireCallerWorkspaceRole",
    "isInstructorForWorkspace", "isOwnedByIdentity"
  ];
  for (const h of whitelist) {
    if (new RegExp(`\\b${h}\\s*\\(`).test(body)) return true;
  }
  return false;
}

const findings: { file: string; line: number; name: string; msg: string }[] = [];

for (const file of files) {
  const src = readFileSync(file, "utf8");
  const funcs = matchPublicFunction(src);
  for (const fn of funcs) {
    fn.file = relative(CONVEX_DIR, file);
    if (!fn.isPublic) continue;
    if (fn.type !== "mutation" && fn.type !== "action") continue;
    if (hasAuthCheck(fn.body)) continue;
    // Look for ctx.db.patch, ctx.db.insert, ctx.db.delete, ctx.db.replace anywhere.
    const writeRe = /\bctx\.db\.(insert|patch|delete|replace)\b/;
    if (writeRe.test(fn.body)) {
      const m = fn.body.match(writeRe);
      findings.push({
        file: fn.file,
        line: fn.startLine,
        name: fn.name,
        msg: `public ${fn.type} performs ${m![1]} with NO auth check at all`,
      });
    }
  }
}

const out = findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

// Write findings to ./artifacts/ — relative to wherever the script is invoked
// from. CI uploads these via actions/upload-artifact@v4.
mkdirSync("./artifacts", { recursive: true });
// An empty finding set writes an empty file (not "\n"), so the file's line
// count equals the finding count. The PR-comment step relies on `wc -l`.
writeFileSync(
  "./artifacts/findings-noauth.txt",
  out.length === 0
    ? ""
    : out.map((f) => `${f.file.padEnd(50)} :${String(f.line).padEnd(5)} ${f.name.padEnd(40)} ${f.msg}`).join("\n") + "\n"
);
console.log(`No-auth writable mutations: ${out.length}`);
