/**
 * Backfill Script: backfill-instructor-inventory.ts
 *
 * HUC-46: one-shot copy of `instructor_inventory` rows from Supabase
 * into the matching Convex `instructors.oneOnOneInventory` +
 * `instructors.groupInventory` fields. Convex is the authoritative
 * inventory store (PR #873); the Supabase table is now a legacy
 * mirror that the public offer page used to read. Until this
 * backfill runs, Convex rows default to 0 and any decrement (e.g.
 * the Kajabi webhook's `/inventory/apply`) would fail with
 * "Insufficient inventory".
 *
 * Usage (from project root):
 *   pnpm backfill:inventory
 *
 *   # Or with explicit target URL (the script reads CONVEX_URL /
 *   # NEXT_PUBLIC_CONVEX_URL — there is no CONVEX_DEPLOYMENT flag):
 *   CONVEX_URL=https://huckleberry-prod.convex.site \
 *     pnpm backfill:inventory
 *
 *   # Dry-run (logs intended writes, makes no HTTP calls):
 *   DRY_RUN=1 pnpm backfill:inventory
 *
 *   # Force-overwrite ONLY the rows that this run reported as
 *   # skipped (Convex already had a non-zero value or a real
 *   # sold-out zero). Safe by default; preserves live Convex
 *   # values for unrelated rows. Two-pass: phase 1 reports
 *   # skips, phase 2 re-runs those slugs with force: true.
 *   FORCE=1 pnpm backfill:inventory
 *
 *   # Force-overwrite EVERY row regardless of skips. Requires
 *   # an explicit opt-in flag and prints a blast-radius warning
 *   # before each write. Use only if you have a known reason
 *   # to re-mirror every legacy value into Convex (e.g. schema
 *   # was reset out of band). This was the original FORCE=1
 *   # behavior; prefer FORCE=1 alone for almost every case.
 *   FORCE_ALL=1 pnpm backfill:inventory
 *
 * Idempotency: the script reads the source-of-truth Supabase row
 * for every instructor and unconditionally writes the value to
 * Convex. The default non-FORCE behavior preserves any field
 * that already has a non-zero Convex value (treats `0` as a real
 * sold-out value when the field was previously written).
 *
 * Required env vars (mirrors `scripts/migrate-instructors.ts`):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   CONVEX_URL                (server-only `.convex.site` host; falls
 *                              back to NEXT_PUBLIC_CONVEX_URL with
 *                              `.convex.cloud` → `.convex.site` rewrite)
 *   CONVEX_HTTP_KEY
 *
 * The script deliberately uses the `.convex.site` HTTP actions, not
 * the Convex client SDK, because the server-to-server flow is the
 * same one the marketing `/api/instructor/inventory` route uses
 * (so any auth bug surfaces here first).
 */

import { createClient } from "@supabase/supabase-js";

/**
 * Pure-function flag validation. Exported so unit tests can
 * import this without triggering the side-effecting `main()`.
 */
export function validateForceFlags(env: {
  FORCE?: string;
  FORCE_ALL?: string;
  [key: string]: string | undefined;
}): { ok: true } | { ok: false; code: 2; message: string } {
  const force = env.FORCE === "1";
  const forceAll = env.FORCE_ALL === "1";
  if (force && forceAll) {
    return {
      ok: false,
      code: 2,
      message:
        "FORCE=1 and FORCE_ALL=1 are both set. Pick one: FORCE alone targets only the rows that this run reports as skipped (safe); FORCE_ALL blasts every row (destructive).",
    };
  }
  return { ok: true };
}

interface SupabaseInventoryRow {
  id: string;
  instructor_slug: string;
  one_on_one_inventory: number;
  group_inventory: number;
  updated_at: string;
  updated_by: string | null;
}

interface BackfillResponse {
  success: boolean;
  slug?: string;
  oneOnOneInventory?: number;
  groupInventory?: number;
  /**
   * Fields that the Convex endpoint deliberately did NOT
   * overwrite because they already had a non-zero value.
   * Without this, an operator running a partial backfill (or
   * one that re-runs after a Kajabi purchase) sees only
   * checkmarks and has no way to know which legacy values
   * were not copied — leading to a "successful" exit on an
   * incomplete migration.
   */
  skipped?: string[];
  error?: string;
}

interface SkipRecord {
  slug: string;
  fields: string[];
  legacy: { one_on_one_inventory: number; group_inventory: number };
}

interface RuntimeConfig {
  supabase: ReturnType<typeof createClient>;
  convexBaseUrl: string;
  convexHttpKey: string;
  dryRun: boolean;
  force: boolean;
  forceAll: boolean;
}

function buildRuntimeFromEnv(env: NodeJS.ProcessEnv): RuntimeConfig {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const convexUrl = env.CONVEX_URL ?? env.NEXT_PUBLIC_CONVEX_URL;
  const convexHttpKey = env.CONVEX_HTTP_KEY;
  const missing: string[] = [];
  if (!supabaseUrl) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!supabaseServiceKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!convexUrl) missing.push("CONVEX_URL or NEXT_PUBLIC_CONVEX_URL");
  if (!convexHttpKey) missing.push("CONVEX_HTTP_KEY");
  if (missing.length > 0) {
    console.error("Missing required env vars:", missing.join(", "));
    process.exit(1);
  }
  const flagCheck = validateForceFlags(env);
  if (!flagCheck.ok) {
    console.error(flagCheck.message);
    process.exit(flagCheck.code);
  }
  return {
    supabase: createClient(supabaseUrl!, supabaseServiceKey!),
    convexBaseUrl: convexUrl!.replace(/\/+$/, "").replace(/\.convex\.cloud$/, ".convex.site"),
    convexHttpKey: convexHttpKey!,
    dryRun: env.DRY_RUN === "1",
    force: env.FORCE === "1",
    forceAll: env.FORCE_ALL === "1",
  };
}

async function backfillOne(
  row: SupabaseInventoryRow,
  options: {
    /**
     * Greptile P1 (round 17): when set, force-overwrite EVERY
     * provided field (destructive FORCE_ALL path).
     */
    force: boolean;
    /**
     * Greptile P1 (round 17): per-field force flags for the
     * safe FORCE retry pass. The retry pass sends BOTH
     * inventory fields (the endpoint needs them to compute
     * alreadyMatches/alreadyTouched), but `forceOneOnOne` /
     * `forceGroup` tell the endpoint which fields are allowed
     * to overwrite the live value. A field NOT in this list
     * remains "skip if non-zero / non-undefined" so a Kajabi
     * purchase between phase 1 and phase 2 is not clobbered.
     * Ignored when `force: true` is set.
     */
    forceOneOnOne?: boolean;
    forceGroup?: boolean;
    runtime: RuntimeConfig;
  }
): Promise<{
  slug: string;
  ok: boolean;
  error?: string;
  skipped?: string[];
}> {
  const { runtime } = options;
  const body = {
    slug: row.instructor_slug,
    oneOnOneInventory: row.one_on_one_inventory,
    groupInventory: row.group_inventory,
    ...(options.force
      ? { force: true }
      : {
          ...(options.forceOneOnOne ? { forceOneOnOne: true } : {}),
          ...(options.forceGroup ? { forceGroup: true } : {}),
        }),
  };

  if (runtime.dryRun) {
    const forcedFields: string[] = [];
    if (options.force) forcedFields.push("force (all)");
    if (options.forceOneOnOne) forcedFields.push("forceOneOnOne");
    if (options.forceGroup) forcedFields.push("forceGroup");
    const forceLabel = forcedFields.length > 0 ? ` (${forcedFields.join(", ")})` : "";
    console.log(
      `[dry-run] would patch ${row.instructor_slug}${forceLabel}: 1:1=${row.one_on_one_inventory}, group=${row.group_inventory}`
    );
    return { slug: row.instructor_slug, ok: true };
  }

  const response = await fetch(`${runtime.convexBaseUrl}/inventory/backfill-by-slug`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${runtime.convexHttpKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return {
      slug: row.instructor_slug,
      ok: false,
      error: `HTTP ${response.status}: ${text.slice(0, 300)}`,
    };
  }

  let parsed: BackfillResponse;
  try {
    parsed = (await response.json()) as BackfillResponse;
  } catch (err) {
    return {
      slug: row.instructor_slug,
      ok: false,
      error: `non-JSON response: ${(err as Error).message}`,
    };
  }

  if (!parsed.success) {
    return {
      slug: row.instructor_slug,
      ok: false,
      error: parsed.error ?? "unknown error",
    };
  }

  return {
    slug: row.instructor_slug,
    ok: true,
    skipped: parsed.skipped,
  };
}

async function fetchAllRows(
  runtime: RuntimeConfig
): Promise<SupabaseInventoryRow[]> {
  // Greptile P2 (round 13): paginate the source read so a
  // table that grows beyond Supabase's response limit can't
  // silently truncate. Page size 500 keeps each request well
  // under the 1k row default ceiling and matches the repo's
  // pagination convention for tables that can grow.
  const PAGE_SIZE = 500;
  const rows: SupabaseInventoryRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await runtime.supabase
      .from("instructor_inventory")
      .select("id, instructor_slug, one_on_one_inventory, group_inventory, updated_at, updated_by")
      .order("instructor_slug")
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error("Supabase read failed:", error);
      process.exit(1);
    }

    const page = (data ?? []) as SupabaseInventoryRow[];
    rows.push(...page);

    if (page.length < PAGE_SIZE) {
      // Last page.
      break;
    }
  }
  return rows;
}

async function runPhase(
  rowsToProcess: SupabaseInventoryRow[],
  options: {
    /**
     * Global force flag — when true, every row is force-overwritten
     * in its entirety. Use FORCE_ALL=1 path.
     */
    force: boolean;
    /**
     * Per-row force fields. When `force` is false, a row's
     * per-field overrides are used instead. Maps slug →
     * { forceOneOnOne, forceGroup }. Used by the FORCE retry
     * pass to target only the fields reported as skipped in
     * phase 1.
     */
    perRowForceFields?: Map<string, { forceOneOnOne: boolean; forceGroup: boolean }>;
    phaseLabel: string;
    runtime: RuntimeConfig;
  }
): Promise<{
  succeeded: number;
  succeededWithSkips: number;
  failed: number;
  notFound: number;
  failures: Array<{ slug: string; error: string }>;
  skips: SkipRecord[];
}> {
  let succeeded = 0;
  let succeededWithSkips = 0;
  let failed = 0;
  let notFound = 0;
  const failures: Array<{ slug: string; error: string }> = [];
  const skips: SkipRecord[] = [];

  for (const row of rowsToProcess) {
    const perRow = options.perRowForceFields?.get(row.instructor_slug);
    const result = await backfillOne(row, {
      force: options.force,
      forceOneOnOne: perRow?.forceOneOnOne,
      forceGroup: perRow?.forceGroup,
      runtime: options.runtime,
    });
    if (result.ok) {
      succeeded++;
      const skipped = result.skipped ?? [];
      if (skipped.length > 0) {
        succeededWithSkips++;
        skips.push({
          slug: row.instructor_slug,
          fields: skipped,
          legacy: {
            one_on_one_inventory: row.one_on_one_inventory,
            group_inventory: row.group_inventory,
          },
        });
        console.log(
          `△ ${row.instructor_slug} (skipped: ${skipped.join(", ")} — Convex already had non-zero values; legacy ${skipped.map((f) => `${f}=${f === "oneOnOneInventory" ? row.one_on_one_inventory : row.group_inventory}`).join(", ")} NOT applied)`
        );
      } else if (options.force) {
        console.log(`✓ ${row.instructor_slug} (force)`);
      } else if (perRow) {
        const forced: string[] = [];
        if (perRow.forceOneOnOne) forced.push("1:1");
        if (perRow.forceGroup) forced.push("group");
        console.log(`✓ ${row.instructor_slug} (forced: ${forced.join(", ")})`);
      } else {
        console.log(`✓ ${row.instructor_slug}`);
      }
    } else {
      failed++;
      const message = result.error ?? "unknown";
      if (message.includes("Instructor not found")) {
        notFound++;
        console.warn(
          `? ${row.instructor_slug} (not in Convex — instructor may be unlisted, soft-deleted, or missing)`
        );
      } else {
        console.error(`✗ ${row.instructor_slug}: ${message}`);
      }
      failures.push({ slug: row.instructor_slug, error: message });
    }
  }

  return { succeeded, succeededWithSkips, failed, notFound, failures, skips };
}

/**
 * Main entrypoint. Reads env, runs the two-phase backfill.
 * Exported so tests can call it with a synthesized RuntimeConfig
 * (no env required).
 */
export async function runBackfill(
  runtime: RuntimeConfig
): Promise<{ exitCode: number }> {
  console.log(
    `HUC-46 inventory backfill → ${runtime.convexBaseUrl}/inventory/backfill-by-slug`
  );
  if (runtime.dryRun) {
    console.log("[DRY_RUN=1] No writes will be made.\n");
  }
  if (runtime.force) {
    console.log(
      "[FORCE=1] Two-pass: phase 1 reports skips; phase 2 re-runs ONLY the skipped slugs with force=true.\n"
    );
  }
  if (runtime.forceAll) {
    console.log(
      "[FORCE_ALL=1] Will overwrite every Convex value with the Supabase legacy value, including unrelated instructors with manually-set sold-out zeros. Destructive; confirm with the team before running on prod.\n"
    );
  }

  const rows = await fetchAllRows(runtime);
  console.log(`Found ${rows.length} instructor_inventory rows in Supabase.\n`);

  // Phase 1: dry-or-normal backfill for every row.
  const phase1 = await runPhase(rows, {
    force: runtime.forceAll,
    phaseLabel: "phase-1",
    runtime,
  });

  let phase2: Awaited<ReturnType<typeof runPhase>> | null = null;

  // FORCE (without FORCE_ALL): scope the force pass to ONLY the
  // slugs that phase 1 reported as skipped. This is Greptile's
  // P1 round-15 fix: a global FORCE=1 used to re-run every row
  // with force=true, which could overwrite unrelated instructors'
  // live sold-out zeros with stale positive counts.
  //
  // Greptile P1 (round 17): even scoped to skipped slugs, the
  // retry resend previously overwrote BOTH inventory fields
  // per instructor. If a Kajabi purchase decremented the OTHER
  // field between phase 1 and phase 2, the retry replaced its
  // live value with the stale Supabase value — potentially
  // reopening a sold-out offer. The retry now sends per-field
  // force flags so only the fields reported as skipped are
  // allowed to overwrite.
  if (runtime.force && phase1.skips.length > 0) {
    console.log(
      `\n[FORCE=1] Phase 2: re-running ${phase1.skips.length} skipped slug(s) with per-field force=true.\n`
    );
    const perRowForceFields = new Map<string, { forceOneOnOne: boolean; forceGroup: boolean }>();
    const slugSet = new Set<string>();
    for (const skip of phase1.skips) {
      slugSet.add(skip.slug);
      perRowForceFields.set(skip.slug, {
        forceOneOnOne: skip.fields.includes("oneOnOneInventory"),
        forceGroup: skip.fields.includes("groupInventory"),
      });
    }
    const retryRows = rows.filter((r) => slugSet.has(r.instructor_slug));
    phase2 = await runPhase(retryRows, {
      force: false,
      perRowForceFields,
      phaseLabel: "phase-2",
      runtime,
    });
  }

  console.log(`\n========================================`);
  if (phase2) {
    const totalSucceeded = phase1.succeeded + phase2.succeeded;
    const totalFailed = phase1.failed + phase2.failed;
    const totalNotFound = phase1.notFound + phase2.notFound;
    const remainingSkips = phase2.skips.length;
    console.log(
      `Phase 1: ${phase1.succeeded} succeeded (${phase1.succeededWithSkips} with skipped fields), ${phase1.failed} failed (${phase1.notFound} not-found)`
    );
    console.log(
      `Phase 2: ${phase2.succeeded} force-retried (${phase2.succeededWithSkips} with skipped fields), ${phase2.failed} failed (${phase2.notFound} not-found)`
    );
    console.log(
      `Combined: ${totalSucceeded} succeeded, ${totalFailed} failed (${totalNotFound} not-found), ${remainingSkips} still-skipped after force`
    );
    if (remainingSkips > 0) {
      console.log(
        `\n${remainingSkips} slug(s) still have skipped fields after FORCE=1. These are values that the Convex endpoint still refuses to overwrite — inspect manually.`
      );
    }
  } else {
    console.log(
      `Done: ${phase1.succeeded} succeeded (${phase1.succeededWithSkips} with skipped fields), ${phase1.failed} failed (${phase1.notFound} not-found)`
    );
    if (phase1.skips.length > 0) {
      console.log(`\nSkipped (Convex already had non-zero values — legacy NOT applied):`);
      for (const s of phase1.skips) {
        console.log(`  ${s.slug}: ${s.fields.join(", ")}`);
      }
      console.log(
        `\nTo overwrite these fields, re-run with FORCE=1 (targets ONLY the skipped slugs; safe by default).`
      );
      console.log(
        `For the rare case of re-mirroring every legacy value, run with FORCE_ALL=1 instead.`
      );
    }
  }
  const failures = phase2
    ? [...phase1.failures, ...phase2.failures]
    : phase1.failures;
  if (failures.length > 0) {
    console.log(`\nFailures:`);
    for (const f of failures) {
      console.log(`  ${f.slug}: ${f.error}`);
    }
  }
  console.log(`========================================`);

  // Exit non-zero if any row was a partial backfill — a migration
  // that "succeeded" but skipped legacy fields is incomplete and
  // the operator should reconcile before proceeding to Phase 3
  // narrow. FORCE_ALL passes through with exit 0 because the
  // operator explicitly accepted the blast radius; FORCE=1 with
  // remaining skips also exits 1 because that means the endpoint
  // refused the overwrite (likely a logic bug, not user error).
  const finalSkips = phase2?.skips.length ?? phase1.succeededWithSkips;
  const exitCode =
    phase1.failed > 0 ||
    (phase2?.failed ?? 0) > 0 ||
    (!runtime.forceAll && finalSkips > 0)
      ? 1
      : 0;
  return { exitCode };
}

/**
 * CLI entrypoint. Only runs side-effecting code (network,
 * process.exit) when the file is invoked directly — importing
 * the module for unit tests does NOT trigger any of this.
 */
async function main() {
  const runtime = buildRuntimeFromEnv(process.env);
  const { exitCode } = await runBackfill(runtime);
  process.exit(exitCode);
}

// Detect direct invocation via tsx/node. Uses argv[1] (the
// entry path) versus this file's resolved URL. Avoids the
// brittle `require.main === module` check which doesn't exist
// in ESM. Side-effecting `main()` is only called when this
// script was launched directly; vitest imports see only the
// exported helpers (validateForceFlags, runBackfill) above.
import { fileURLToPath } from "node:url";
import path from "node:path";

function isInvokedDirectly(): boolean {
  if (!process.argv[1]) return false;
  try {
    const entry = path.resolve(process.argv[1]);
    const here = path.resolve(fileURLToPath(import.meta.url));
    return entry === here;
  } catch {
    return false;
  }
}

if (isInvokedDirectly()) {
  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
