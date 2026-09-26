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
 *   # Zero-fill only fields whose Supabase legacy value is null
 *   # or missing — replaces nulls with explicit 0 before posting
 *   # to Convex. The Convex endpoint's skip-if-already-touched
 *   # guard preserves any live (non-zero, non-undefined) Convex
 *   # field, so a run is safe even after Kajabi purchases have
 *   # mutated live counts. This is the HUC-46 Phase 3 narrow SQL
 *   # prerequisite: run it once before applying the SQL migration
 *   # to guarantee no public-offer-visible instructor has an
 *   # unset Convex field (otherwise the marketing route's
 *   # `null → 0` coercion would silently render an available offer
 *   # as sold-out). Cannot be combined with FORCE=1 or FORCE_ALL=1.
 *   ZERO_FILL_NULLS=1 pnpm backfill:inventory
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
  ZERO_FILL_NULLS?: string;
  VERIFY_PUBLIC_COVERAGE?: string;
  [key: string]: string | undefined;
}): { ok: true } | { ok: false; code: 2; message: string } {
  const force = env.FORCE === "1";
  const forceAll = env.FORCE_ALL === "1";
  const zeroFillNulls = env.ZERO_FILL_NULLS === "1";
  const verifyPublicCoverage = env.VERIFY_PUBLIC_COVERAGE === "1";
  if (force && forceAll) {
    return {
      ok: false,
      code: 2,
      message:
        "FORCE=1 and FORCE_ALL=1 are both set. Pick one: FORCE alone targets only the rows that this run reports as skipped (safe); FORCE_ALL blasts every row (destructive).",
    };
  }
  if (zeroFillNulls && (force || forceAll)) {
    return {
      ok: false,
      code: 2,
      message:
        "ZERO_FILL_NULLS=1 cannot be combined with FORCE=1 or FORCE_ALL=1. ZERO_FILL_NULLS only writes 0 to Convex fields that are currently unset (never written); it never overwrites a live Convex value, so it is safe to combine with the normal (non-FORCE) backfill pass.",
    };
  }
  if (verifyPublicCoverage && (force || forceAll || zeroFillNulls)) {
    return {
      ok: false,
      code: 2,
      message:
        "VERIFY_PUBLIC_COVERAGE=1 is a read-only preflight check and cannot be combined with FORCE=1, FORCE_ALL=1, or ZERO_FILL_NULLS=1. Run it on its own as a prerequisite gate.",
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
  /**
   * HUC-46 Phase 3 prerequisite: when true, the script replaces
   * null/undefined Supabase inventory values with explicit 0
   * before posting to Convex. The Convex endpoint's skip-if-
   * already-touched logic preserves any live (non-zero,
   * non-undefined) Convex field, so a run is safe even for
   * instructors whose live Convex state was set by a Kajabi
   * purchase after the original backfill. Use this to guarantee
   * that every public-offer-visible instructor has explicit
   * Convex fields BEFORE applying the Phase 3 SQL migration
   * (which drops the Supabase fallback that masked unset
   * Convex fields as sold-out zeros).
   */
  zeroFillNulls: boolean;
  /**
   * HUC-46 Phase 3 prerequisite gate (Greptile P1, PR #883
   * round 22): when true, the script fetches every public-listed
   * instructor from Convex (via
   * `/inventory/list-public-instructor-slugs-for-backfill`) and
   * verifies that each has non-null inventory fields. Exits
   * non-zero if any public instructor has unset Convex inventory,
   * because the Supabase fallback (which currently masks unset
   * Convex fields as sold-out zeros) is about to be dropped in
   * Phase 3. Read-only; cannot combine with FORCE/FORCE_ALL/
   * ZERO_FILL_NULLS — run it standalone as the preflight check
   * before applying the Phase 3 SQL migration.
   */
  verifyPublicCoverage: boolean;
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
    zeroFillNulls: env.ZERO_FILL_NULLS === "1",
    verifyPublicCoverage: env.VERIFY_PUBLIC_COVERAGE === "1",
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
  /**
   * HUC-46 Phase 3 prerequisite: in ZERO_FILL_NULLS mode, send
   * explicit 0 for any Supabase field that is null/undefined.
   * The Convex endpoint's skip-if-already-touched guard means a
   * live (non-zero) Convex value is preserved untouched; only an
   * unset (undefined) Convex field receives the 0. This makes
   * Phase 3 safe to apply: every public-offer-visible instructor
   * ends up with explicit Convex values, so the
   * `null → 0` coercion in the marketing route no longer hides
   * a "never-written" Convex field as a sold-out zero.
   */
  const oneOnOneInventory = runtime.zeroFillNulls
    ? (row.one_on_one_inventory ?? 0)
    : row.one_on_one_inventory;
  const groupInventory = runtime.zeroFillNulls
    ? (row.group_inventory ?? 0)
    : row.group_inventory;
  const body = {
    slug: row.instructor_slug,
    oneOnOneInventory,
    groupInventory,
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
    if (runtime.zeroFillNulls) forcedFields.push("zero-fill-nulls");
    const forceLabel = forcedFields.length > 0 ? ` (${forcedFields.join(", ")})` : "";
    // Greptile P2 (round 20, PR #883): in ZERO_FILL_NULLS mode
    // the request body is prepared with 0 for any null field, so
    // the dry-run preview must show the COMPUTED values that
    // would be posted — otherwise an operator running
    // `DRY_RUN=1 ZERO_FILL_NULLS=1 pnpm backfill:inventory` would
    // see `null` in the preview and conclude that no write would
    // happen, missing the actual zero-fill.
    console.log(
      `[dry-run] would patch ${row.instructor_slug}${forceLabel}: 1:1=${oneOnOneInventory}, group=${groupInventory}`
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

/**
 * HUC-46 Phase 3 prerequisite gate (Greptile P1, PR #883 round 22).
 * Returns the slug + raw inventory fields for every public-listed
 * instructor in Convex. Unlike `getPublicInstructors`, this query
 * returns RAW (null for never-written, number for touched) so the
 * caller can detect "Convex has never been touched for this
 * instructor" — the exact signal the Phase 3 narrow SQL
 * migration's preflight check needs.
 */
async function fetchPublicInstructors(
  runtime: RuntimeConfig
): Promise<
  Array<{
    slug: string;
    oneOnOneInventory: number | null;
    groupInventory: number | null;
  }>
> {
  const response = await fetch(
    `${runtime.convexBaseUrl}/inventory/list-public-instructor-slugs-for-backfill`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${runtime.convexHttpKey}`,
      },
      body: JSON.stringify({}),
    }
  );

  if (!response.ok) {
    throw new Error(
      `Convex HTTP action returned ${response.status}: ${await response.text()}`
    );
  }

  const payload = (await response.json()) as {
    success: boolean;
    instructors?: Array<{
      slug: string;
      oneOnOneInventory: number | null;
      groupInventory: number | null;
    }>;
    error?: string;
  };

  if (!payload.success || !payload.instructors) {
    throw new Error(
      `Convex HTTP action returned success=false: ${payload.error ?? "unknown"}`
    );
  }
  return payload.instructors;
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
  if (runtime.zeroFillNulls) {
    console.log(
      "[ZERO_FILL_NULLS=1] Will replace null Supabase inventory values with explicit 0 before posting to Convex. The Convex endpoint's skip-if-already-touched guard preserves any live (non-zero, non-undefined) Convex field, so this is safe to run after Kajabi purchases. Use this as the Phase 3 narrow SQL prerequisite to guarantee no instructor has an unset Convex field.\n"
    );
  }

  let rows = await fetchAllRows(runtime);
  console.log(`Found ${rows.length} instructor_inventory rows in Supabase.\n`);

  // Greptile P1 (PR #883 round 22): when ZERO_FILL_NULLS=1 is set,
  // ALSO pull the public-listed instructor slugs from Convex and
  // synthesise phantom Supabase rows for any slug not already
  // present in the Supabase fetch. Without this, a public
  // instructor who never had a Supabase inventory row would
  // skip the zero-fill pass entirely — leaving their Convex
  // inventory unset. After Phase 3 drops the Supabase fallback,
  // the marketing route's `null → 0` coercion would render
  // their offer as sold-out with no signal that the inventory
  // was never initialised.
  if (runtime.zeroFillNulls) {
    const publicInstructors = await fetchPublicInstructors(runtime);
    const slugSet = new Set(rows.map((r) => r.instructor_slug));
    const synthesised: string[] = [];
    for (const inst of publicInstructors) {
      if (slugSet.has(inst.slug)) continue;
      rows.push({
        id: `phantom-${inst.slug}`,
        instructor_slug: inst.slug,
        one_on_one_inventory: null,
        group_inventory: null,
        updated_at: new Date(0).toISOString(),
        updated_by: null,
      });
      synthesised.push(inst.slug);
    }
    if (synthesised.length > 0) {
      console.log(
        `[ZERO_FILL_NULLS=1] Synthesised ${synthesised.length} phantom Supabase row(s) for public instructor(s) without a Supabase inventory row: ${synthesised.join(", ")}. Each phantom row posts 0/0 to Convex; the endpoint's skip-if-already-touched guard preserves any live Convex value.\n`
      );
    }
  }

  // HUC-46 Phase 3 prerequisite gate (Greptile P1, PR #883 round 22).
  // Read-only preflight that verifies every public-listed instructor
  // has explicit non-null Convex inventory BEFORE the Supabase
  // fallback is dropped. If any instructor's Convex inventory is
  // null/undefined for any field, the script exits non-zero so the
  // operator can run ZERO_FILL_NULLS=1 first (or manually zero-fill).
  //
  // Greptile P1 round 23 (local review of 1037f1aa): a previous
  // version of this check skipped the Convex field inspection for
  // any slug that ALSO had a Supabase row — reasoning that the
  // backfill script would cover it. That was wrong: the backfill
  // script reads Supabase values, but if those Supabase values are
  // themselves null and ZERO_FILL_NULLS=1 is NOT set, the script
  // posts `null` to Convex and the endpoint's skip-if-already-
  // touched guard may not initialize either. The check therefore
  // inspects Convex fields for every public instructor regardless
  // of Supabase coverage. If a slug has both a Supabase row AND
  // non-null Convex fields, it's logged as "covered by backfill";
  // if it has any null Convex field, it goes into `missing`.
  if (runtime.verifyPublicCoverage) {
    const publicInstructors = await fetchPublicInstructors(runtime);
    const slugSet = new Set(rows.map((r) => r.instructor_slug));
    const missing: Array<{ slug: string; missingFields: string[] }> = [];
    const coveredByBackfill: string[] = [];
    const coveredByConvex: string[] = [];
    for (const inst of publicInstructors) {
      const missingFields: string[] = [];
      if (inst.oneOnOneInventory === null) missingFields.push("oneOnOneInventory");
      if (inst.groupInventory === null) missingFields.push("groupInventory");
      if (missingFields.length > 0) {
        missing.push({ slug: inst.slug, missingFields });
        continue;
      }
      if (slugSet.has(inst.slug)) {
        coveredByBackfill.push(inst.slug);
      } else {
        coveredByConvex.push(inst.slug);
      }
    }
    console.log(
      `\n[VERIFY_PUBLIC_COVERAGE=1] Coverage check on ${publicInstructors.length} public-listed instructor(s):`
    );
    console.log(
      `  - ${coveredByBackfill.length} have BOTH a Supabase inventory row AND non-null Convex fields (covered by the backfill script)`
    );
    console.log(
      `  - ${coveredByConvex.length} have non-null Convex fields but NO Supabase row (already covered by another path)`
    );
    if (missing.length === 0) {
      console.log(
        "\n  All public instructors have non-null Convex inventory fields. Phase 3 SQL is safe to apply.\n"
      );
      return {
        succeeded: 0,
        succeededWithSkips: 0,
        failed: 0,
        notFound: 0,
        failures: [],
        skips: [],
      };
    }
    console.log(
      `\n  ${missing.length} public instructor(s) have unset Convex inventory fields. The Supabase fallback masks these as sold-out zeros today; after Phase 3 drops the fallback, these offers would appear sold out with no signal of why. Run ZERO_FILL_NULLS=1 pnpm backfill:inventory to zero-fill them before applying the SQL migration.\n`
    );
    for (const m of missing) {
      console.log(`    - ${m.slug}: missing ${m.missingFields.join(", ")}`);
    }
    process.exit(1);
  }

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
      if (runtime.zeroFillNulls) {
        // Greptile P1 (round 21, PR #883): in ZERO_FILL_NULLS mode
        // the Convex endpoint's skip-if-already-touched guard
        // intentionally preserves any live (non-zero) Convex
        // field. A "skipped" row here means "Convex already had
        // a value that the script chose to preserve" — which is
        // the desired outcome of this mode, not a failure. Tell
        // the operator that explicitly so they don't reach for
        // FORCE=1 (which is rightly refused by the validator and
        // would also defeat the purpose of the safe mode).
        console.log(
          `\nSkipped fields (live Convex value preserved — expected for ZERO_FILL_NULLS):`
        );
        for (const s of phase1.skips) {
          console.log(`  ${s.slug}: ${s.fields.join(", ")}`);
        }
        console.log(
          `\nNo further action needed: live Convex values are correct. ZERO_FILL_NULLS only writes 0 to fields that were unset; any field with a live value was intentionally left untouched.`
        );
      } else {
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
  //
  // Greptile P1 (round 21, PR #883): ZERO_FILL_NULLS=1 is the
  // exception. In that mode, a "skip" means "Convex had a live
  // non-zero value, which we preserved on purpose" — which is
  // exactly the outcome the operator wants. Counting those as
  // failures would make the prerequisite exit 1 even when every
  // public-offer-visible instructor has explicit Convex values.
  // Skips in zero-fill mode are success indicators, not failures.
  const finalSkips = phase2?.skips.length ?? phase1.succeededWithSkips;
  const skipIsFailure = !runtime.zeroFillNulls;
  const exitCode =
    phase1.failed > 0 ||
    (phase2?.failed ?? 0) > 0 ||
    (skipIsFailure && !runtime.forceAll && finalSkips > 0)
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
