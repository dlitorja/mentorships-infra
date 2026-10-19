#!/usr/bin/env tsx
/**
 * One-off ops script: stamp `publicMetadata.role = "instructor"` on a
 * Clerk user that the admin "create instructor" flow adopted by email
 * lookup but never had the role flag written to.
 *
 * Background: this is the LEGACY data fix for `fix/instructor-role-claim-in-clerk`.
 * The PR patches create/edit instructor flows in `apps/platform` so future
 * creates/edits stamp `publicMetadata.role = "instructor"` on the Clerk
 * user record right away (Clerk invitations carry the role on the
 * invitation only, not on a pre-existing user). This script is for the
 * users that were missed BEFORE that PR shipped.
 *
 * Usage (from repo root):
 *   tsx apps/platform/scripts/claim-instructor-role.mts \
 *     --clerk-secret-key sk_xxxxx \
 *     --clerk-user-id user_xxxx \
 *     [--instructor-id inst_xxxx]    # optional, stamps publicMetadata.instructorId
 *     [--apply]                       # omit for dry-run
 *
 *   DRY-RUN is the default — read and log only. Pass `--apply` to write.
 *   Idempotent: a user that already has `role: "instructor"` AND
 *   `isInstructor: true` is reported as "already-set" and skipped.
 *
 * Convex mirror: this script intentionally does NOT touch the Convex
 * `users.role` field. The instructor's next sign-in routes correctly the
 * moment Clerk publicMetadata is set (unblocks auth-redirect + protected
 * layout). The Convex `users.role` for the same clerkId self-heals via
 * the new sync-role route mounted on `/instructor/*` (post-PR-merge):
 * `POST /api/instructor/sync-role` runs `api.users.syncUser({role:
 * "instructor"})` once and is idempotent. Spawning a separate admin
 * write here would just duplicate that flow.
 *
 * Exit codes:
 *   - 0 success (idempotent no-op OR write succeeded)
 *   - 1 input error (missing arg, malformed id)
 *   - 2 API error (Clerk unreachable/denied/unexpected shape)
 *
 * NEVER prints the secret values passed via flags. Existing
 * publicMetadata IS shown verbatim because it is public-by-design and
 * contains no secrets.
 */

type Args = {
  clerkSecretKey: string;
  clerkUserId: string;
  instructorId?: string;
  apply: boolean;
};

function parseArgs(argv: string[]): Args | { error: string } {
  const out: Partial<Args> = { apply: false };
  const needsValue = (flag: string, next: string | undefined): string | null => {
    if (next === undefined) return `Missing value for ${flag}`;
    if (next.startsWith("--")) return `Missing value for ${flag} (next arg "${next}" looks like another flag)`;
    return null;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case "--clerk-secret-key": {
        const err = needsValue(a, next);
        if (err) return { error: err };
        out.clerkSecretKey = next;
        i++;
        break;
      }
      case "--clerk-user-id": {
        const err = needsValue(a, next);
        if (err) return { error: err };
        if (!next.startsWith("user_")) {
          return { error: `--clerk-user-id must start with "user_"; got "${next.slice(0, 8)}..."` };
        }
        out.clerkUserId = next;
        i++;
        break;
      }
      case "--instructor-id": {
        const err = needsValue(a, next);
        if (err) return { error: err };
        out.instructorId = next;
        i++;
        break;
      }
      case "--apply":
        out.apply = true;
        break;
      case "--help":
      case "-h":
        process.stdout.write(
          "Usage: tsx apps/platform/scripts/claim-instructor-role.mts \\\n" +
            "  --clerk-secret-key <sk_xxx> \\\n" +
            "  --clerk-user-id <user_xxx> \\\n" +
            "  [--instructor-id <inst_xxx>] \\\n" +
            "  [--apply]\n" +
            "\n" +
            "DRY-RUN: reads Clerk publicMetadata and shows before/after.\n" +
            "--apply:  commits the metadata change.\n",
        );
        process.exit(0);
      default:
        return { error: `Unknown flag: ${a}` };
    }
  }
  for (const k of ["clerkSecretKey", "clerkUserId"] as const) {
    if (!out[k]) {
      const flagName = "--" + k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
      return { error: `Missing ${flagName}` };
    }
  }
  return out as Args;
}

/**
 * Clerk Backend API helpers. Per Clerk's API reference (2025-05):
 *   - `GET    /v1/users/{user_id}`           — read user + public_metadata
 *   - `PATCH  /v1/users/{user_id}/metadata`  — deep-merge public/private/unsafe metadata
 *
 * The dedicated `/metadata` endpoint is the correct surface for
 * metadata-only updates: the legacy `PUT /v1/users/{user_id}` shape
 * has been deprecated. Use snake_case (`public_metadata`) on the wire
 * — that's what Clerk's Backend API documents, not camelCase.
 *
 * Greptile P1 (second pass): the original helper incorrectly used
 * `POST /v1/users/{id}/metadata` with a camelCase `publicMetadata`
 * field. Both were silent failures (some Clerk instances respond 400
 * with a vague message; others ignore the body). The PATCH + snake_case
 * pair is what the API actually expects.
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

async function stampClerkMetadata(args: Args): Promise<{ ok: boolean; reason?: string }> {
  const get = await clerkGetUser(args);
  if (get.status === 404) {
    return { ok: false, reason: `Clerk user not found: ${args.clerkUserId}` };
  }
  if (get.status !== 200) {
    return { ok: false, reason: `Clerk GET /v1/users/{id} returned ${get.status}` };
  }
  const user = get.body as {
    public_metadata?: Record<string, unknown>;
    email_addresses?: Array<{ email_address?: string }>;
  };
  const current = user.public_metadata ?? {};
  // Idempotent short-circuit on the fully-stamped shape (matches
  // the helper in `apps/platform/lib/clerk-invitations.ts`,
  // Greptile P1 fourth pass). The previous `isInstructor === true`
  // check was too aggressive: a desynced user (admin manually
  // changed `role` via the Clerk dashboard so role !== "instructor"
  // but `isInstructor` is still true) was unrepairable from this
  // script. Both flags must be present. Override behavior: if the
  // caller passes `--instructor-id`, we re-write so the new id is
  // stamped even when the role flag was set previously.
  const alreadyInstructor =
    current.isInstructor === true &&
    current.role === "instructor" &&
    !args.instructorId;

  const primaryEmail = user.email_addresses?.[0]?.email_address ?? "(no email)";

  if (alreadyInstructor) {
    process.stdout.write(
      `[clerk] ${args.clerkUserId} already has isInstructor=true; no write needed.\n` +
        `[clerk] current publicMetadata: ${JSON.stringify(current)}\n`,
    );
    return { ok: true };
  }

  const currentRole = typeof current.role === "string" ? current.role : undefined;
  const nextRole =
    currentRole && isElevatedRole(currentRole) ? currentRole : "instructor";

  const merged: Record<string, unknown> = {
    ...current,
    isInstructor: true,
    role: nextRole,
  };
  if (args.instructorId) {
    merged.instructorId = args.instructorId;
  }

  if (!args.apply) {
    process.stdout.write(
      `[clerk] DRY-RUN: would PATCH metadata on ${args.clerkUserId}:\n` +
        `  before: ${JSON.stringify(current)}\n` +
        `  after:  ${JSON.stringify(merged)}\n` +
        `  email:  ${primaryEmail}\n` +
        `Re-run with --apply to commit.\n`,
    );
    return { ok: true };
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

  // Verify post-write by re-reading. Catches silent failures.
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
  process.stdout.write(
    `[clerk] verified ${args.clerkUserId} now has isInstructor=true; role=${String(post.role ?? "(unset)")}.\n`,
  );
  return { ok: true };
}

/**
 * Mirror-stamp the Convex `users` row. This catches the case where the
 * Clerk flag was set but the Convex row's `role` column is stale.
 *
 * The Convex HTTP gateway takes the form `POST {convexUrl}/api/mutation`
 * with `Authorization: Convex <adminAuth>`. The mutation path
 * `internal:users:setUserRoleTrusted` is callable from
 * server-verified HTTP (admin-keyed) requests; the actorId/actorRole
 * fields audit the change.
 */
async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if ("error" in parsed) {
    process.stderr.write(`error: ${parsed.error}\n`);
    process.stderr.write("Use --help for usage.\n");
    process.exit(1);
  }
  const args = parsed;

  process.stdout.write(
    `[start] clerk-user-id=${args.clerkUserId} instructor-id=${args.instructorId ?? "(none)"} apply=${args.apply}\n`,
  );

  let exitCode = 0;
  try {
    const clerk = await stampClerkMetadata(args);
    if (!clerk.ok) {
      process.stderr.write(`[clerk] FAILED: ${clerk.reason}\n`);
      exitCode = 2;
    }
  } catch (err) {
    process.stderr.write(
      `[clerk] FAILED with thrown error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    exitCode = 2;
  }

  process.stdout.write(
    `[done] exit=${exitCode}.\n` +
      `Note: the Convex users.role for this clerkId self-heals on the user's next\n` +
      `sign-in via the new /api/instructor/sync-role route (EnsureInstructorRole\n` +
      `is mounted on /instructor/* pages). No separate Convex write is required.\n`,
  );
  process.exit(exitCode);
}

main().catch((err) => {
  process.stderr.write(`unhandled: ${err instanceof Error ? err.stack || err.message : String(err)}\n`);
  process.exit(2);
});
