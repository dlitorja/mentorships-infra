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
 *   pnpm tsx scripts/migrate-to-convex/backfill-instructor-inventory.ts
 *
 *   # Or with explicit target URL (the script reads CONVEX_URL /
 *   # NEXT_PUBLIC_CONVEX_URL — there is no CONVEX_DEPLOYMENT flag):
 *   CONVEX_URL=https://huckleberry-prod.convex.site \
 *     pnpm tsx scripts/migrate-to-convex/backfill-instructor-inventory.ts
 *
 *   # Dry-run (logs intended writes, makes no HTTP calls):
 *   DRY_RUN=1 pnpm tsx scripts/migrate-to-convex/backfill-instructor-inventory.ts
 *
 *   # Force-overwrite even when Convex already has a non-zero value:
 *   FORCE=1 pnpm tsx scripts/migrate-to-convex/backfill-instructor-inventory.ts
 *
 * Idempotency: the script reads the source-of-truth Supabase row
 * for every instructor and unconditionally writes the value to
 * Convex. If you re-run after a Kajabi purchase, Convex will be
 * reset to the Supabase value (re-introducing the original bug).
 * Run only once during the cut-over window, then drop the
 * `instructor_inventory` Supabase table.
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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing Supabase env vars");
  console.error("NEXT_PUBLIC_SUPABASE_URL:", supabaseUrl ? "✓" : "✗");
  console.error("SUPABASE_SERVICE_ROLE_KEY:", supabaseServiceKey ? "✓" : "✗");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

function resolveConvexBaseUrl(): string {
  const explicit = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!explicit) {
    console.error("Missing CONVEX_URL or NEXT_PUBLIC_CONVEX_URL");
    process.exit(1);
  }
  return explicit.replace(/\/+$/, "").replace(/\.convex\.cloud$/, ".convex.site");
}

const convexBaseUrl = resolveConvexBaseUrl();
const convexHttpKey = process.env.CONVEX_HTTP_KEY;
if (!convexHttpKey) {
  console.error("Missing CONVEX_HTTP_KEY");
  process.exit(1);
}

const DRY_RUN = process.env.DRY_RUN === "1";
const FORCE = process.env.FORCE === "1";

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

async function backfillOne(row: SupabaseInventoryRow): Promise<{
  slug: string;
  ok: boolean;
  error?: string;
  skipped?: string[];
}> {
  const body = {
    slug: row.instructor_slug,
    oneOnOneInventory: row.one_on_one_inventory,
    groupInventory: row.group_inventory,
    ...(FORCE ? { force: true } : {}),
  };

  if (DRY_RUN) {
    console.log(
      `[dry-run] would patch ${row.instructor_slug}: 1:1=${row.one_on_one_inventory}, group=${row.group_inventory}`
    );
    return { slug: row.instructor_slug, ok: true };
  }

  const response = await fetch(`${convexBaseUrl}/inventory/backfill-by-slug`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${convexHttpKey}`,
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

async function main() {
  console.log(`HUC-46 inventory backfill → ${convexBaseUrl}/inventory/backfill-by-slug`);
  if (DRY_RUN) {
    console.log("[DRY_RUN=1] No writes will be made.\n");
  }
  if (FORCE) {
    console.log(
      "[FORCE=1] Will overwrite non-zero Convex values. Use only after operator review.\n"
    );
  }

  const { data, error } = await supabase
    .from("instructor_inventory")
    .select("id, instructor_slug, one_on_one_inventory, group_inventory, updated_at, updated_by")
    .order("instructor_slug");

  if (error) {
    console.error("Supabase read failed:", error);
    process.exit(1);
  }

  const rows = (data ?? []) as SupabaseInventoryRow[];
  console.log(`Found ${rows.length} instructor_inventory rows in Supabase.\n`);

  let succeeded = 0;
  let succeededWithSkips = 0;
  let failed = 0;
  let notFound = 0;
  const failures: Array<{ slug: string; error: string }> = [];
  const skips: Array<{ slug: string; fields: string[]; legacy: { one_on_one_inventory: number; group_inventory: number } }> = [];

  for (const row of rows) {
    const result = await backfillOne(row);
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

  console.log(`\n========================================`);
  console.log(`Done: ${succeeded} succeeded (${succeededWithSkips} with skipped fields), ${failed} failed (${notFound} not-found)`);
  if (skips.length > 0) {
    console.log(`\nSkipped (Convex already had non-zero values — legacy NOT applied):`);
    for (const s of skips) {
      console.log(`  ${s.slug}: ${s.fields.join(", ")}`);
    }
    if (!FORCE) {
      console.log(`\nTo overwrite these fields, re-run with FORCE=1 (after operator review).`);
    }
  }
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
  // narrow. Allow `FORCE=1` runs to exit 0 even with skips since
  // the operator opted in to overwriting.
  process.exit(failed > 0 || (succeededWithSkips > 0 && !FORCE) ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
