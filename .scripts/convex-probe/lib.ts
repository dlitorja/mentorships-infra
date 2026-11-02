/* eslint-disable */
// lib.ts — shared detection helpers for the Tier 1 convex-probe scanners.
//
// Kept separate from `scan-b.ts` / `scan-d.ts` so the heuristics can be
// unit-tested without triggering a full repo scan. The scanners import
// these functions; detection behaviour is identical to the pilot-era
// inline copies except where the 2026-10 triage (§4) prescribes a fix.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Auth / ownership heuristics
// ---------------------------------------------------------------------------

/**
 * Helpers that prove the caller was authenticated (and usually authorized).
 * A `(` suffix check is deliberate: a bare mention of the name (e.g. in a
 * comment) must not count.
 */
export const AUTH_HELPERS = [
  "getUserIdentity", "requireIdentity", "requireIdentityForMutation",
  "requireRole", "requireOwner", "assertOwner", "assertRole", "getIdentity",
  "getAuthedIdentity", "getCurrentUser", "requireUser", "requireCaller",
  // Role / admin helpers
  "requireAdminUser", "requireStaffRole", "requireAdmin", "requireAdminOrSupport",
  "requireAdminOrSelfVideoEditor", "isStaffCaller", "isAdmin", "isAdminUser",
  "requireAdminActor",
  "lookupStaffRole", "ensureAssignedStudent", "canViewSubmission",
  "canViewOnboarding", "detectRenewal",
  // Service-key helpers (server-to-server callers)
  "assertServiceKey",
  // Upload / delete guards
  "requireDeleteAccess", "requireAdminDeleteAccess", "requireAssignedStudentForUpload",
  // Workspace / participation helpers
  "assertParticipantForSession", "assertParticipant", "assertWorkspaceParticipant",
  "assertSessionBelongsToWorkspace", "assertB2FileUploadOwnedByCaller",
  "assertResourceBelongsToInstructor", "assertCanModifySessionPack",
  "getWorkspaceRole", "getCallerWorkspaceRole", "requireCallerWorkspaceRole",
  "isInstructorForWorkspace", "isOwnedByIdentity",
];

/**
 * Helpers / comparisons that prove the caller's identity was checked against
 * the row being read or written.
 */
export const IDENTITY_COMPARISON_HELPERS = [
  "requireOwner", "assertOwner", "requireIdentity", "getIdentity",
  "isStaffCaller", "requireAdminUser", "assertParticipantForSession",
  "assertParticipant", "requireStaffRole", "requireRole", "requireUser",
  "requireAdmin", "requireAdminOrSupport", "requireAdminOrSelfVideoEditor",
  "requireAdminActor", "isAdminUser",
  "assertServiceKey",
  "requireDeleteAccess", "requireAdminDeleteAccess", "requireAssignedStudentForUpload",
  "assertSessionBelongsToWorkspace", "assertB2FileUploadOwnedByCaller",
  "assertResourceBelongsToInstructor", "assertCanModifySessionPack",
  "getWorkspaceRole", "getCallerWorkspaceRole", "requireCallerWorkspaceRole",
  "isInstructorForWorkspace", "ensureAssignedStudent", "canViewSubmission",
  "canViewOnboarding", "isOwnedByIdentity", "getCurrentUser",
];

/**
 * True if the function body shows any authentication/authorization gate.
 *
 * @param allowBareSubjectReference scan-b treats *any* mention of
 *   `identity.subject` as "has some auth" so shape (b) can distinguish
 *   "authorized but no row comparison" from "no auth at all". scan-d must
 *   stay stricter: mentioning the subject is not a gate.
 */
export function hasAuthCheck(
  body: string,
  options: { allowBareSubjectReference?: boolean } = {},
): boolean {
  if (/\bctx\.auth\b/.test(body)) return true;

  for (const h of AUTH_HELPERS) {
    if (new RegExp(`\\b${h}\\s*\\(`).test(body)) return true;
  }

  // Service-key transport: the function declares `serviceKey: v.string()`.
  // `assertServiceKey` is in AUTH_HELPERS; this catches the sibling shape
  // where the arg is declared but the assertion lives in a helper module.
  if (/\bserviceKey\s*:\s*v\.string\s*\(/.test(body)) return true;

  // Role resolved onto a caller object, e.g. `caller.role === "admin"`.
  if (/\bcaller\s*\.\s*role\s*(===|!==|==|!=)/.test(body)) return true;

  if (options.allowBareSubjectReference && /\bidentity\s*\.\s*subject\b/.test(body)) {
    return true;
  }

  return false;
}

/** Strip comments and string literals so comparisons in prose don't count. */
export function stripNonCode(body: string): string {
  return body
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/`[^`]*`/g, '""')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

/** True if the body compares the caller's identity against a loaded row. */
export function hasIdentityComparison(body: string): boolean {
  const stripped = stripNonCode(body);

  // `identity.subject` on either side.
  if (/identity\s*\.\s*subject\s*(===|!==|==|!=)/.test(stripped)) return true;
  if (/(===|!==|==|!=)\s*identity\s*\.\s*subject/.test(stripped)) return true;

  // Generic `.subject` comparison, both sides (e.g. `row.userId !== user.subject`).
  if (/\.\s*subject\s*(===|!==|==|!=)/.test(stripped)) return true;
  if (/(===|!==|==|!=)\s*\w+\.subject\b/.test(stripped)) return true;

  // Ownership via a loaded instructor/owner row (`workspace.instructorId !== instructor._id`).
  if (/\b(instructor|owner)\s*\.\s*_id\s*(===|!==|==|!=)/.test(stripped)) return true;
  if (/(===|!==|==|!=)\s*(instructor|owner)\s*\.\s*_id\b/.test(stripped)) return true;

  for (const h of IDENTITY_COMPARISON_HELPERS) {
    if (new RegExp(`\\b${h}\\b`).test(stripped)) return true;
  }

  return false;
}

export function lineAt(src: string, offset: number): number {
  return src.slice(0, offset).split("\n").length;
}

// ---------------------------------------------------------------------------
// Findings, suppressions, and the committed baseline
// ---------------------------------------------------------------------------

export type Finding = {
  file: string;
  line: number;
  name: string;
  /** Present for scan-b (a/b/c/d); absent for scan-d. */
  shape?: string;
  msg: string;
};

export type Suppression = {
  file: string;
  function: string;
  scanner: "scan-b" | "scan-d";
  /** Optional scan-b shape (a/b/c/d); omitted matches any shape. */
  shape?: string;
  reason: string;
  owner: string;
  /** ISO date (YYYY-MM-DD). Omitted = never expires. */
  expires?: string;
};

export type SuppressionsFile = {
  $comment?: string;
  suppressions: Suppression[];
};

export type SuppressedFinding = Finding & {
  suppression: { reason: string; owner: string; expires?: string };
};

/** Returns null when the date is unparsable (callers treat that as invalid). */
function expiryTime(expires: string): number | null {
  const parsed = new Date(`${expires}T23:59:59.999Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function isExpired(suppression: Suppression, today: Date): boolean {
  if (!suppression.expires) return false;
  const expiry = expiryTime(suppression.expires);
  // Defensive: loadSuppressions rejects unparsable dates as invalid.
  if (expiry === null) return true;
  return today.getTime() > expiry;
}

/**
 * Loads `suppressions.json` from the probe directory. Invalid entries are
 * skipped with a warning; expired entries are returned separately so the
 * caller can warn that the finding is intentionally resurfacing.
 */
export function loadSuppressions(
  probeDir: string,
  options: { today?: Date } = {},
): { active: Suppression[]; expired: Suppression[]; invalid: string[] } {
  const today = options.today ?? new Date();
  const path = resolve(probeDir, "suppressions.json");
  let parsed: SuppressionsFile;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as SuppressionsFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { active: [], expired: [], invalid: [] };
    }
    throw err;
  }

  const active: Suppression[] = [];
  const expired: Suppression[] = [];
  const invalid: string[] = [];

  for (const [index, entry] of (parsed.suppressions ?? []).entries()) {
    const label = `${entry?.file ?? "?"}::${entry?.function ?? "?"}`;
    const ok =
      typeof entry?.file === "string" &&
      typeof entry?.function === "string" &&
      (entry.scanner === "scan-b" || entry.scanner === "scan-d") &&
      typeof entry.reason === "string" &&
      entry.reason.trim().length > 0 &&
      typeof entry.owner === "string" &&
      entry.owner.trim().length > 0;
    if (!ok) {
      invalid.push(`suppressions[${index}] ${label}: missing file/function/scanner/reason/owner`);
      continue;
    }
    // An unparsable expiry must never mean "never expires": a typo would
    // suppress the finding forever. Reject the entry instead.
    if (entry.expires !== undefined) {
      if (typeof entry.expires !== "string" || expiryTime(entry.expires) === null) {
        invalid.push(
          `suppressions[${index}] ${label}: invalid expires "${String(entry.expires)}" (expected YYYY-MM-DD)`,
        );
        continue;
      }
    }
    if (isExpired(entry, today)) {
      expired.push(entry);
    } else {
      active.push(entry);
    }
  }

  return { active, expired, invalid };
}

function suppressionMatches(suppression: Suppression, finding: Finding): boolean {
  return (
    suppression.file === finding.file &&
    suppression.function === finding.name &&
    (suppression.shape === undefined || suppression.shape === finding.shape)
  );
}

/**
 * Splits findings into kept/suppressed for one scanner. Suppressions are
 * scanner-scoped, so a scan-d entry cannot hide a scan-b hit.
 */
export function partitionSuppressed(
  findings: Finding[],
  suppressions: Suppression[],
  scanner: "scan-b" | "scan-d",
): { kept: Finding[]; suppressed: SuppressedFinding[] } {
  const kept: Finding[] = [];
  const suppressed: SuppressedFinding[] = [];
  const scoped = suppressions.filter((s) => s.scanner === scanner);

  for (const finding of findings) {
    const match = scoped.find((s) => suppressionMatches(s, finding));
    if (match) {
      suppressed.push({
        ...finding,
        suppression: {
          reason: match.reason,
          owner: match.owner,
          ...(match.expires ? { expires: match.expires } : {}),
        },
      });
    } else {
      kept.push(finding);
    }
  }

  return { kept, suppressed };
}

export function writeSuppressedArtifact(path: string, suppressed: SuppressedFinding[]): void {
  writeFileSync(path, JSON.stringify(suppressed, null, 2));
}

/** Probe directory, used for suppressions/baseline when running via tsx. */
export function probeDirFromArgv(): string {
  return dirname(resolve(process.argv[1] ?? "."));
}

// ---------------------------------------------------------------------------
// Baseline / week-over-week diff
// ---------------------------------------------------------------------------

export type BaselineFinding = { file: string; name: string; shape?: string };

export type Baseline = {
  generatedAt: string;
  $comment?: string;
  scanB: { total: number; byShape: Record<string, number>; findings: BaselineFinding[] };
  scanD: { total: number; findings: BaselineFinding[] };
};

export function findingKey(finding: BaselineFinding): string {
  return `${finding.file}::${finding.name}::${finding.shape ?? ""}`;
}

export type DiffResult = {
  total: number;
  baselineTotal: number;
  byShape: Record<string, number>;
  new: BaselineFinding[];
  fixed: BaselineFinding[];
};

export function diffAgainstBaseline(
  current: BaselineFinding[],
  baseline: BaselineFinding[],
): DiffResult {
  const baselineKeys = new Set(baseline.map(findingKey));
  const currentKeys = new Set(current.map(findingKey));

  return {
    total: current.length,
    baselineTotal: baseline.length,
    byShape: current.reduce<Record<string, number>>((acc, f) => {
      const key = f.shape ?? "no-shape";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
    new: current.filter((f) => !baselineKeys.has(findingKey(f))),
    fixed: baseline.filter((f) => !currentKeys.has(findingKey(f))),
  };
}
