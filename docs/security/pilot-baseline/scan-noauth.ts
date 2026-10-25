#!/usr/bin/env -S npx tsx
/* eslint-disable */
// Step 1 SCAN (variant 2) — no-auth writable operations.

import { readFileSync, statSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = "/home/dlitorja/projects/mentorships-infra-sec-pilot";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir)) {
    const p = join(dir, ent);
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

const files = walk(join(ROOT, "convex"));

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
    fn.file = relative(ROOT, file);
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
writeFileSync(
  "/tmp/opencode/sec-pilot/findings-noauth.txt",
  out.map((f) => `${f.file.padEnd(50)} :${String(f.line).padEnd(5)} ${f.name.padEnd(40)} ${f.msg}`).join("\n") + "\n"
);
console.log(`No-auth writable mutations: ${out.length}`);
