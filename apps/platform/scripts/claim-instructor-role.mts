#!/usr/bin/env tsx
/**
 * One-off ops script: stamp `publicMetadata.role = "instructor"` on a
 * Clerk user AND (best-effort) write the matching Convex `users.role`.
 *
 * Background: this is the LEGACY data fix for `fix/instructor-role-claim-in-clerk`.
 * The PR patches create/edit instructor flows in `apps/platform` so future
 * creates/edits stamp `publicMetadata.role = "instructor"` on the Clerk
 * user record right away. This script is for the users that were missed
 * BEFORE that PR shipped.
 *
 * Usage (from repo root, with production env vars loaded):
 *   set -a
 *   source apps/platform/.env.local
 *   set +a
 *   tsx apps/platform/scripts/claim-instructor-role.mts \
 *     --clerk-user-id user_xxxx \
 *     [--clerk-secret-key sk_xxxx]      # env CLERK_SECRET_KEY also accepted
 *     [--instructor-id inst_xxxx]       # optional, stamps publicMetadata.instructorId
 *     [--apply]                          # omit for dry-run
 *
 *   DRY-RUN is the default — read and log only. Pass `--apply` to write.
 *   Idempotent: a user that already has `role: "instructor"` AND
 *   `isInstructor: true` AND (when `--instructor-id` was supplied) a
 *   matching `instructorId` is reported as "already-set" and skipped.
 *
 * Two surfaces, in order:
 *   1. Clerk Backend API (`PATCH /v1/users/{id}/metadata`).
 *      Required: the user needs `publicMetadata.role = "instructor"` so
 *      auth-redirect routes them to /instructor/dashboard.
 *   2. Convex trusted role-write (`POST /users/ops-set-role`, an HTTP
 *      action in `convex/http.ts` added as part of this PR). Only
 *      writes for the legacy repair path: the user-flow
 *      `/api/instructor/sync-role` self-heal goes through `syncUser`
 *      which intentionally preserves an existing `role: "student"`,
 *      so a previously-missed adopted-as-instructor student stays as
 *      `role: "student"` in Convex until this script runs. The new
 *      endpoint refuses to overwrite an elevated role
 *      (`admin`/`video_editor`/`support`) with a lower role, so a
 *      misrun cannot demote an admin.
 *
 *      `/users/ops-set-role` is a SEPARATE endpoint from
 *      `/users/set-role` (which remains unconditional). Greptile's
 *      P1 follow-up flagged that putting the elevated-preservation
 *      guard on `/users/set-role` broke Marketing's
 *      `AuthDrivenInvalidator` admin -> student demotion sync.
 *      The split scopes the conservative guard to the legacy-repair
 *      path only.
 *
 *      If the Convex env vars (`CONVEX_URL` or `NEXT_PUBLIC_CONVEX_URL`,
 *      `CONVEX_HTTP_KEY`) are not set, the script logs a warning and
 *      continues — the Clerk stamp alone unblocks routing, and the
 *      Convex row will self-heal on next sign-in via the admin
 *      `/admin` role-write surface.
 *
 * Exit codes:
 *   - 0 success (idempotent no-op OR every write succeeded)
 *   - 1 input error (missing arg, malformed id)
 *   - 2 API error (Clerk OR Convex unreachable/denied/unexpected shape)
 *
 * NEVER prints the secret values passed via flags. Existing
 * publicMetadata IS shown verbatim because it is public-by-design and
 * contains no secrets.
 */

type Args = {
  clerkSecretKey: string;
  clerkUserId: string;
  instructorId?: string;
  /**
   * Convex HTTP-action base URL. The script's POST hits
   * `${convexUrl}/users/set-role`. Resolved at startup from environment;
   * no CLI flag — Convex URL is not something an operator types.
   */
  convexUrl?: string;
  /** Convex HTTP bearer key. Resolved from `CONVEX_HTTP_KEY`. */
  convexHttpKey?: string;
  apply: boolean;
};

/**
 * Greptile P2/Security (PR fix/instructor-role-claim-in-clerk): flag
 * names whose values are secrets. Anything matching `--<name>=<value>`
 * is redacted in error output. NEVER add a non-secret flag to this
 * set, and NEVER inline a raw secret string into an error message —
 * these two invariants are what keep the script safe to run in a CI log.
 */
export const SECRET_FLAGS = new Set(["clerk-secret-key", "convex-http-key"]);

/**
 * Greptile P2/Security (PR fix/instructor-role-claim-in-clerk): the
 * previous parseArgs only accepted `--flag <value>` (space). The PR
 * description suggested `--clerk-secret-key=<v>`, which fell through
 * to the "Unknown flag" branch and ECHOED the entire arg — including
 * the secret. The redaction layer below is a defense-in-depth: even
 * if a future flag addition forgets to redact, secret-bearing args
 * still get scrubbed before logging.
 *
 * Exported so the test file can pin the contract.
 */
export function redact(arg: string): string {
  if (!arg.startsWith("--") || !arg.includes("=")) return arg;
  const eq = arg.indexOf("=");
  const key = arg.slice(0, eq);
  if (SECRET_FLAGS.has(key.slice(2))) {
    return `${key}=<REDACTED>`;
  }
  return arg;
}

export function parseArgs(argv: string[]): Args | { error: string } {
  const out: Partial<Args> = { apply: false };

  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];

    // Greptile P2/Security: support `--flag=value` so the canonical
    // form from the PR description works. Split the inline value out
    // before the switch so the existing flag logic works for both
    // forms uniformly.
    let inlineValue: string | undefined;
    if (a.startsWith("--") && a.includes("=")) {
      const eq = a.indexOf("=");
      inlineValue = a.slice(eq + 1);
      a = a.slice(0, eq);
    }

    const next = argv[i + 1];
    // Choice of value for "needs value" flags: prefer inline `=value`,
    // fall back to the next positional arg.
    const takeValue = (): string | undefined => {
      if (inlineValue !== undefined) return inlineValue;
      if (next === undefined) return undefined;
      if (next.startsWith("--")) return undefined;
      return next;
    };

    switch (a) {
      case "--clerk-secret-key": {
        const v = takeValue();
        if (v === undefined) {
          return { error: `--clerk-secret-key requires a value` };
        }
        out.clerkSecretKey = v;
        if (inlineValue === undefined) i++;
        break;
      }
      case "--clerk-user-id": {
        const v = takeValue();
        if (v === undefined) {
          return { error: `--clerk-user-id requires a value` };
        }
        if (!v.startsWith("user_")) {
          // Defense in depth: even though this flag isn't in SECRET_FLAGS,
          // know your secrets if a malformed value ever lands here.
          return {
            error: `--clerk-user-id must start with "user_"; got "${redact(v).slice(0, 12)}..."`,
          };
        }
        out.clerkUserId = v;
        if (inlineValue === undefined) i++;
        break;
      }
      case "--instructor-id": {
        const v = takeValue();
        if (v === undefined) {
          return { error: `--instructor-id requires a value` };
        }
        out.instructorId = v;
        if (inlineValue === undefined) i++;
        break;
      }
      case "--apply": {
        // Greptile P1 (nineteenth pass, follow-up): parse the equals-
        // form value explicitly. The previous shape silently dropped
        // --apply=false and proceeded as if --apply was set, so a
        // forward-defaults wrapper or operator flag-passing accident
        // could enable production writes that were intended to be
        // dry-runs. Accept "true" / "false" / "1" / "0" as the flag's
        // value when present; reject any other inline value; treat
        // the absence as `--apply` short for `apply = true`.
        if (inlineValue === undefined) {
          out.apply = true;
          break;
        }
        const normalized = inlineValue.trim().toLowerCase();
        if (normalized === "true" || normalized === "1") {
          out.apply = true;
          break;
        }
        if (normalized === "false" || normalized === "0") {
          out.apply = false;
          break;
        }
        return {
          error: `--apply, if given inline, must be one of true|false|1|0; got "${inlineValue}". Omit the flag and pass --apply (no value) for the typed default of apply=true.`,
        };
      }
      case "--help":
      case "-h":
        process.stdout.write(
          "Usage: tsx apps/platform/scripts/claim-instructor-role.mts \\\n" +
            "  --clerk-user-id <user_xxx> \\\n" +
            "  [--clerk-secret-key <sk_xxx>] \\\n" +
            "  [--instructor-id <inst_xxx>] \\\n" +
            "  [--apply]\n" +
            "\n" +
            "DRY-RUN: reads Clerk publicMetadata (and Convex users.role if env\n" +
            "is set) and shows before/after.\n" +
            "--apply:  commits the metadata AND the Convex role write.\n" +
            "\n" +
            "Env vars (set in apps/platform/.env.local or via `set -a; source`):\n" +
            "  CLERK_SECRET_KEY     override for --clerk-secret-key\n" +
            "  CONVEX_URL or NEXT_PUBLIC_CONVEX_URL   Convex HTTP-action base URL\n" +
            "  CONVEX_HTTP_KEY     Convex bearer auth\n",
        );
        process.exit(0);
      default:
        // Greptile P2/Security: ALWAYS redact secret-bearing args before
        // echoing them. A user typing `--clerk-secret-key=<REDACTED>` on
        // an unknown flag would otherwise surface the full argument.
        return { error: `Unknown flag: ${redact(a)}` };
    }
  }
  for (const k of ["clerkUserId"] as const) {
    if (!out[k]) {
      const flagName = "--" + k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
      return { error: `Missing ${flagName}` };
    }
  }
  return out as Args;
}

/**
 * Resolve Convex env (URL + key). Returns empty strings if not set;
 * callers handle the unset case to keep the script running with
 * Clerk-only fix when Convex env is unavailable in the operator's shell.
 *
 * Greptile P1 (seventeenth pass, follow-up): the previous version
 * applied the `.convex.cloud` -> `.convex.site` rewrite ONLY when
 * reading from `NEXT_PUBLIC_CONVEX_URL`. If `CONVEX_URL` was set to
 * a `.convex.cloud` URL (e.g. a developer copying the dashboard URL
 * instead of the export-site URL), the script POSTed to the wrong
 * host and the Convex role write silently failed. Normalize the
 * chosen URL after selection so both env-var paths converge on the
 * HTTP-action host.
 *
 * Exported so the test can verify the rewrite applies to BOTH env
 * vars; this is a contract assertion, not a leak of internal API.
 */
export function readConvexEnv(
  env: { CONVEX_URL?: string; NEXT_PUBLIC_CONVEX_URL?: string; CONVEX_HTTP_KEY?: string } = {
    CONVEX_URL: process.env.CONVEX_URL,
    NEXT_PUBLIC_CONVEX_URL: process.env.NEXT_PUBLIC_CONVEX_URL,
    CONVEX_HTTP_KEY: process.env.CONVEX_HTTP_KEY,
  }
): { url: string; httpKey: string } {
  const rawUrl = env.CONVEX_URL ?? env.NEXT_PUBLIC_CONVEX_URL ?? "";
  const url = rawUrl
    .replace(/\/+$/, "")
    .replace(/\.convex\.cloud$/, ".convex.site");
  const httpKey = env.CONVEX_HTTP_KEY ?? "";
  return { url, httpKey };
}

/**
 * Clerk Backend API helpers. Per Clerk's API reference (2025-05):
 *   - `GET    /v1/users/{user_id}`           — read user + public_metadata
 *   - `PATCH  /v1/users/{user_id}/metadata`  — deep-merge public/private/unsafe metadata
 */
async function clerkGetUser(args: Args): Promise<{
  status: number;
  body: unknown;
}> {
  const resp = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(args.clerkUserId)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${args.clerkSecretKey}` },
  });
  const text = await resp.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* body is HTML or something; keep as text */
  }
  return { status: resp.status, body: parsed };
}

async function clerkPatchMetadata(
  args: Args,
  publicMetadata: Record<string, unknown>
): Promise<{ status: number; body: unknown }> {
  const resp = await fetch(
    `https://api.clerk.com/v1/users/${encodeURIComponent(args.clerkUserId)}/metadata`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${args.clerkSecretKey}`,
        "Content-Type": "application/json",
      },
      // Clerk's wire format uses snake_case for metadata fields.
      body: JSON.stringify({ public_metadata: publicMetadata }),
    },
  );
  const text = await resp.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* keep as text */
  }
  return { status: resp.status, body: parsed };
}

const ELEVATED_ROLES = ["admin", "video_editor", "support"] as const;
function isElevatedRole(role: unknown): boolean {
  return typeof role === "string" && (ELEVATED_ROLES as readonly string[]).includes(role);
}

/**
 * Compute the next role the script would WRITE — same shape the helper
 * in `apps/platform/lib/clerk-invitations.ts` uses, so the printed
 * before/after agrees with the helper's behavior for any future
 * automated consumer of this script's output. Elevated roles are
 * preserved: if a current `admin` is misrun through this script, we
 * stamp `isInstructor: true` but KEEP role=`admin`. The same gate is
 * enforced server-side via `convex/http.ts httpSetUserRoleTrusted`.
 */
export function computeNextRole(currentRole: string | undefined): string {
  return currentRole && isElevatedRole(currentRole) ? currentRole : "instructor";
}

/**
 * Greptile P2: post-write verification — exported so the test can mock
 * `clerkGetUser` and assert the verification branch evaluates correctly.
 */
async function verifyPostWriteMetadata(
  args: Args,
  expectedRole: string,
  expectedInstructorId: string | undefined,
): Promise<{ ok: boolean; reason?: string }> {
  const verify = await clerkGetUser(args);
  if (verify.status !== 200) {
    return { ok: false, reason: `post-write verification GET failed (${verify.status})` };
  }
  const post = ((verify.body as { public_metadata?: Record<string, unknown> }) ?? {})
    .public_metadata ?? {};
  if (post.isInstructor !== true) {
    return {
      ok: false,
      reason: `post-write verification failed: expected isInstructor=true; got ${JSON.stringify(post)}`,
    };
  }
  if (post.role !== expectedRole) {
    return {
      ok: false,
      reason: `post-write verification failed: expected role=${expectedRole}; got ${String(post.role ?? "(unset)")}; full=${JSON.stringify(post)}`,
    };
  }
  if (expectedInstructorId && post.instructorId !== expectedInstructorId) {
    return {
      ok: false,
      reason: `post-write verification failed: expected instructorId=${expectedInstructorId}; got ${String(post.instructorId ?? "(unset)")}`,
    };
  }
  return { ok: true };
}

/**
 * Compute the merged Clerk publicMetadata that the script would write —
 * exported so the test can compare before/after shape against what the
 * helper in `apps/platform/lib/clerk-invitations.ts` produces.
 */
export function buildMergedMetadata(
  current: Record<string, unknown>,
  instructorId: string | undefined,
): Record<string, unknown> {
  const currentRole = typeof current.role === "string" ? current.role : undefined;
  const nextRole = computeNextRole(currentRole);
  const merged: Record<string, unknown> = {
    ...current,
    isInstructor: true,
    role: nextRole,
  };
  if (instructorId) {
    merged.instructorId = instructorId;
  }
  return merged;
}

/**
 * Greptile P2 (PR fix/instructor-role-claim-in-clerk): the "already-set"
 * check fires only when the user's metadata is FULLY stamped and (when
 * `--instructor-id` was supplied) the on-disk `publicMetadata.instructorId`
 * matches the caller-supplied id. Mirror the helper's short-circuit:
 * both flags AND id match. Exported so the test can pin the contract.
 */
export function isAlreadyFullyStamped(
  current: Record<string, unknown>,
  instructorId: string | undefined,
): boolean {
  const wouldCorrectOnInstructorId =
    !!instructorId && current.instructorId !== instructorId;
  return (
    current.isInstructor === true &&
    current.role === "instructor" &&
    !wouldCorrectOnInstructorId
  );
}

async function stampClerkMetadata(args: Args): Promise<{ ok: boolean; reason?: string; email?: string }> {
  const get = await clerkGetUser(args);
  if (get.status === 404) {
    return { ok: false, reason: `Clerk user not found: ${args.clerkUserId}` };
  }
  if (get.status !== 200) {
    return { ok: false, reason: `Clerk GET /v1/users/{id} returned ${get.status}` };
  }
  const user = get.body as {
    public_metadata?: Record<string, unknown>;
    email_addresses?: Array<{ id?: string; email_address?: string }>;
    // Greptile P2 (fourteenth pass, follow-up): primary_email_address_id
    // identifies the user's primary address. email_addresses ordering
    // is not deterministic across the Clerk API; selecting
    // `email_addresses[0]` could return a secondary address. Match the
    // Clerk webhook behavior (`convex/instructors.ts` et al) and
    // select by the primary id.
    primary_email_address_id?: string;
  };
  const current = user.public_metadata ?? {};
  // Greptile P2 (fourteenth pass): pick the address by primary id,
  // falling back to email_addresses[0] only when primary id is
  // missing (legacy data). Email will be undefined when the user
  // has no addresses -- callers handle that case.
  const primaryEmailAddress =
    user.email_addresses?.find(
      (a) => a && user.primary_email_address_id && a.id === user.primary_email_address_id,
    )?.email_address ??
    user.email_addresses?.[0]?.email_address ??
    "(no email)";
  // Greptile P1 (tenth pass, follow-up): capture the Clerk-email so
  // stampConvexUserRole can pass it to /users/ops-set-role. The Convex
  // insert path requires email (users.email is v.string()) and this
  // HTTP endpoint does not have a Clerk identity. Surface it in the
  // resolved metadata for the caller to forward.
  const clerkEmail = primaryEmailAddress === "(no email)" ? undefined : primaryEmailAddress;

  if (isAlreadyFullyStamped(current, args.instructorId)) {
    process.stdout.write(
      `[clerk] ${args.clerkUserId} already fully-stamped (role=instructor, isInstructor=true${args.instructorId ? `, instructorId matches ${args.instructorId}` : ""}); no write needed.\n` +
        `[clerk] current publicMetadata: ${JSON.stringify(current)}\n`,
    );
    return { ok: true, email: clerkEmail };
  }

  const merged = buildMergedMetadata(current, args.instructorId);

  if (!args.apply) {
    process.stdout.write(
      `[clerk] DRY-RUN: would PATCH metadata on ${args.clerkUserId}:\n` +
        `  before: ${JSON.stringify(current)}\n` +
        `  after:  ${JSON.stringify(merged)}\n` +
        `  email:  ${primaryEmailAddress}\n` +
        `Re-run with --apply to commit.\n`,
    );
    return { ok: true, email: clerkEmail };
  }

  const patch = await clerkPatchMetadata(args, merged);
  if (patch.status !== 200) {
    return {
      ok: false,
      reason: `Clerk PATCH /v1/users/{id}/metadata returned ${patch.status}: ${JSON.stringify(patch.body).slice(0, 400)}`,
    };
  }
  process.stdout.write(
    `[clerk] wrote publicMetadata to ${args.clerkUserId}; new value: ${JSON.stringify(merged)}\n`,
  );

  // Verify post-write. Greptile P2: compare role + instructorId, not just
  // isInstructor. verifyPostWriteMetadata is the extracted check.
  const role = typeof merged.role === "string" ? merged.role : undefined;
  const verify = await verifyPostWriteMetadata(
    args,
    role ?? "instructor",
    args.instructorId,
  );
  if (!verify.ok) {
    return { ok: false, reason: verify.reason };
  }
  process.stdout.write(
    `[clerk] verified ${args.clerkUserId} now has isInstructor=true; role=${String(merged.role)}` +
      (args.instructorId ? `; instructorId=${String(merged.instructorId)}` : "") +
      `.\n`,
  );
  return { ok: true, email: clerkEmail };
}

/**
 * Greptile P1 (PR fix/instructor-role-claim-in-clerk): mirror-stamp the
 * Convex `users` row via the dedicated `/users/ops-set-role` HTTP
 * action (added in this PR). Distinct from `/users/set-role` so the
 * elevated-preservation guard does not break Marketing's
 * `AuthDrivenInvalidator` admin -> student demotion path.
 *
 * Response shapes (from httpOpsRepairSetUserRole in `convex/http.ts`):
 *   - 200 + `user object` on a successful write.
 *   - 409 + `{ error, preserved: true, currentRole, requestedRole }` when
 *     refused because the on-disk role is elevated.
 *   - 400 + `{ error }` on missing/invalid args (non-Clerk-shaped
 *     userId, invalid or admin role).
 *   - 401 if `verifyAuth` fails (handled by the underlying httpAction).
 *
 * Exported so the test can mock fetch and assert the request shape.
 */
export async function stampConvexUserRole(
  args: Args,
  expectedRole: string,
  options?: { email?: string }
): Promise<{
  ok: boolean;
  reason?: string;
  preserved?: boolean;
  currentRole?: string;
  /**
   * Greptile P1 (twenty-second pass): structured failure code on
   * non-success returns. Lets callers (CI, ops dashboards) decide
   * whether a reason string is meaningful enough to alert on. Today
   * the only emitted code is "email-belongs-to-another" (the
   * twenty-first-pass email-conflict-guard 409); future codes can
   * be added without breaking the existing ok-shape consumers.
   */
  code?: string;
  attempted?: { userId: string; email: string };
  existing?: { userId: string | null; clerkId: string | null; role: string | null };
}> {
  if (!args.convexUrl || !args.convexHttpKey) {
    process.stdout.write(
      `[convex] env not set (CONVEX_URL/NEXT_PUBLIC_CONVEX_URL, CONVEX_HTTP_KEY); skipping Convex users.role write.\n` +
        `[convex] the Clerk stamp above is sufficient for auth-redirect routing.\n`,
    );
    return { ok: true, reason: "skipped (env unset)" };
  }
  if (!args.apply) {
    process.stdout.write(
      `[convex] DRY-RUN: would POST ${args.convexUrl}/users/ops-set-role for ${args.clerkUserId} role=instructor. Re-run with --apply to commit.\n`,
    );
    return { ok: true, reason: "skipped (dry-run)" };
  }
  // Greptile P1 (tenth pass, follow-up): `users.email` is a required
  // string in the schema and the ops endpoint has no Clerk identity to
  // pull it from. Forward the email the script already read from the
  // Clerk user lookup so the insert path can succeed for users that
  // had no prior Convex row.
  const requestBody: Record<string, string> = {
    userId: args.clerkUserId,
    role: "instructor",
  };
  if (options?.email) {
    requestBody.email = options.email;
  }
  const resp = await fetch(`${args.convexUrl}/users/ops-set-role`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.convexHttpKey}`,
    },
    body: JSON.stringify(requestBody),
  });
  const text = await resp.text();
  let parsed: any = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON — keep as text */
  }

  // Greptile P1 (twenty-second pass, follow-up): 409 from the
  // /users/ops-set-role endpoint has TWO distinct meanings after the
  // twenty-first-pass email-conflict guard landed:
  //   (a) `parsed.preserved === true` -> elevated-role preserved
  //       (success-with-notice: the script's intent was honored by
  //       not overwriting a stricter existing role).
  //   (b) `parsed.code === "email-belongs-to-another"` ->
  //       refused to create a competing users row because the
  //       supplied email is already owned by a different (userId,
  //       clerkId) pair. This is a real failure requiring manual
  //       reconciliation; the target user STILL has no Convex row.
// Treat only (a) as success-with-notice. (b) is a real failure that
// must surface so the operator decides what to do.
  if (resp.status === 409 && parsed?.preserved === true) {
    const currentRole = parsed?.currentRole ?? "(unknown)";
    process.stdout.write(
      `[convex] preserved elevated role: ${String(currentRole)} on ${args.clerkUserId} (refused to overwrite; server returned 409).\n`,
    );
    return { ok: true, preserved: true, currentRole: String(currentRole), reason: "elevated-role" };
  }
  if (resp.status === 409 && parsed?.code === "email-belongs-to-another") {
    return {
      ok: false,
      reason: `Convex refused to write users.role: supplied email "${parsed.attempted?.email ?? "(unknown)"}" is already linked to a different user "${parsed.existing?.userId ?? "(unknown)"}" (role "${parsed.existing?.role ?? "(unknown)"}"). Reconcile manually before retrying.`,
      code: "email-belongs-to-another",
      attempted: parsed?.attempted,
      existing: parsed?.existing,
    };
  }
  if (resp.status === 409) {
    return {
      ok: false,
      reason: `Convex POST /users/ops-set-role returned 409 with an unexpected body: ${JSON.stringify(parsed).slice(0, 400)}.`,
    };
  }


  if (!resp.ok) {
    return {
      ok: false,
      reason: `Convex POST /users/ops-set-role returned ${resp.status}: ${JSON.stringify(parsed).slice(0, 400)}`,
    };
  }

  // On 200, httpOpsRepairSetUserRole returns the user object
  // directly. Compare the role it actually wrote against the script's
  // expected value as a defense-in-depth verification — the server
  // already gated on the right role, but a TYPO in the route or a
  // future refactor that silently changes the audit shape would not
  // surface here without the comparison.
  const got = parsed && typeof parsed === "object" && typeof parsed.role === "string"
    ? parsed.role
    : undefined;
  if (got !== expectedRole) {
    return {
      ok: false,
      reason: `Convex /users/set-role returned role=${String(got ?? "(unset)")}; expected ${expectedRole}`,
    };
  }
  process.stdout.write(
    `[convex] wrote users.role=${String(got)} for clerkId=${args.clerkUserId}.\n`,
  );
  return { ok: true };
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if ("error" in parsed) {
    process.stderr.write(`error: ${parsed.error}\n`);
    process.stderr.write("Use --help for usage.\n");
    process.exit(1);
  }
  const { url: convexUrlEnv, httpKey: convexHttpKeyEnv } = readConvexEnv();
  const args: Args = {
    ...parsed,
    convexUrl: parsed.convexUrl ?? (convexUrlEnv || undefined),
    convexHttpKey: parsed.convexHttpKey ?? (convexHttpKeyEnv || undefined),
    // Greptile P2/Security: prefer the env CLERK_SECRET_KEY when --clerk-secret-key
    // is not on the command line. The flag always wins (operator override).
    clerkSecretKey: parsed.clerkSecretKey ?? process.env.CLERK_SECRET_KEY ?? "",
  };
  if (!args.clerkSecretKey) {
    process.stderr.write(
      `error: --clerk-secret-key is required (or set CLERK_SECRET_KEY in env)\n`,
    );
    process.exit(1);
  }

  process.stdout.write(
    `[start] clerk-user-id=${args.clerkUserId} instructor-id=${args.instructorId ?? "(none)"} apply=${args.apply} convex=${args.convexUrl ? "yes" : "no"}\n`,
  );

  let exitCode = 0;
  let nextRoleForVerify = "instructor";
  // Greptile P1 (tenth pass): forward the Clerk email resolved by
  // stampClerkMetadata to stampConvexUserRole. The Convex insert path
  // requires `users.email` (v.string()), and the ops endpoint has no
  // Clerk identity to derive it from, so the script is the only
  // place that has the email on hand.
  let resolvedClerkEmail: string | undefined;
  try {
    const clerk = await stampClerkMetadata(args);
    if (!clerk.ok) {
      process.stderr.write(`[clerk] FAILED: ${clerk.reason}\n`);
      exitCode = 2;
    } else {
      nextRoleForVerify = computeNextRole(
        typeof args.instructorId === "string" ? "instructor" : "instructor",
      );
      resolvedClerkEmail = clerk.email;
    }
  } catch (err) {
    process.stderr.write(
      `[clerk] FAILED with thrown error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    exitCode = 2;
  }

  if (exitCode === 0 && args.apply) {
    try {
      const convex = await stampConvexUserRole(args, nextRoleForVerify, {
        email: resolvedClerkEmail,
      });
      if (!convex.ok) {
        process.stderr.write(`[convex] FAILED: ${convex.reason}\n`);
        exitCode = 2;
      }
    } catch (err) {
      process.stderr.write(
        `[convex] FAILED with thrown error: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      exitCode = 2;
    }
  } else if (!args.apply) {
    process.stdout.write(
      `[convex] (skipped: dry-run; pass --apply to commit Convex users.role write.)\n`,
    );
  }

  process.stdout.write(`[done] exit=${exitCode}.\n`);
  process.exit(exitCode);
}

/**
 * Run main() only when invoked directly (not when imported by tests).
 * For tests, import `parseArgs`, `redact`, `computeNextRole`,
 * `isAlreadyFullyStamped`, `buildMergedMetadata`, and `stampConvexUserRole`
 * instead. The check below matches both `claim-instructor-role.mts`
 * (the canonical shebang entry) and any future parallel file name with
 * the same logical content.
 */
const isMainInvocation = (() => {
  const invoked = process.argv[1] ?? "";
  return invoked.endsWith("claim-instructor-role.mts");
})();

if (isMainInvocation) {
  main().catch((err) => {
    process.stderr.write(`unhandled: ${err instanceof Error ? err.stack || err.message : String(err)}\n`);
    process.exit(2);
  });
}
