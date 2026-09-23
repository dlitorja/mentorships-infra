/**
 * One-time migration: copies rows from Supabase `inventory_change_log`
 * into the new Convex `inventoryChangeLog` table so the digest email's
 * "Inventory Changes" section continues to show historical adjustments
 * after PR 7 consolidated reads to Convex.
 *
 * Usage (from project root):
 *   CONVEX_HTTP_KEY=<key> \
 *     SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> \
 *     npx tsx scripts/migrate-inventory-change-log.ts
 *
 * Reads `NEXT_PUBLIC_CONVEX_URL` (or `CONVEX_URL`) from the local
 * environment to resolve the Convex HTTP endpoint. Hits `POST
 * /inventory-change-log/import-bulk` on the dev or prod deployment
 * in batches of 200. Idempotent: the internal mutation uses
 * `(instructorSlug, mentorshipType, changeType, oldValue, newValue,
 * changedAt)` as the dedup key and skips triples that already exist.
 *
 * The Kajabi webhook still writes to Supabase `inventory_change_log`
 * after this script runs — a separate follow-up migrates the webhook
 * path to Convex. Until then, new inventory changes will not appear in
 * the digest's "Inventory Changes" section.
 *
 * Safe to re-run. Idempotent: the internal mutation dedups by
 * `legacyId` (Supabase PK). Required secrets:
 *   - CONVEX_HTTP_KEY (Convex deployment HTTP auth)
 *   - SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 */

const BATCH_SIZE = 200;
const CONVEX_URL_ENV_KEYS = ["CONVEX_URL", "NEXT_PUBLIC_CONVEX_URL"] as const;

type SupabaseRow = {
  id: string;
  instructor_slug: string;
  mentorship_type: string | null;
  change_type: string;
  old_value: number;
  new_value: number;
  changed_at: string;
};

type ConvexImportEntry = {
  instructorSlug: string;
  mentorshipType: "oneOnOne" | "group" | null;
  changeType: "manual_update" | "kajabi_purchase";
  oldValue: number;
  newValue: number;
  changedAt: number;
};

type ImportResponse = {
  success: boolean;
  inserted: number;
  skipped: number;
};

function convexSiteUrl(rawUrl: string): string {
  return rawUrl.replace(/\.convex\.cloud$/, ".convex.site");
}

async function fetchSupabaseRows(): Promise<SupabaseRow[]> {
  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. The Supabase read needs the service-role key to enumerate all rows.",
    );
  }

  const all: SupabaseRow[] = [];
  let lastChangedAt: string | null = null;
  let lastId: string | null = null;
  while (true) {
    const url = new URL("/rest/v1/inventory_change_log", supabaseUrl);
    url.searchParams.set(
      "select",
      "id,instructor_slug,mentorship_type,change_type,old_value,new_value,changed_at",
    );
    url.searchParams.set("limit", String(BATCH_SIZE));
    // Stable keyset pagination by (changed_at, id) — see
    // scripts/migrate-marketing-waitlist.ts for the rationale.
    url.searchParams.set("order", "changed_at.asc,id.asc");
    if (lastChangedAt !== null && lastId !== null) {
      url.searchParams.set(
        "or",
        `(changed_at.gt.${lastChangedAt},and(changed_at.eq.${lastChangedAt},id.gt.${lastId}))`,
      );
    }

    const response = await fetch(url, {
      headers: {
        apikey: supabaseServiceKey,
        Authorization: `Bearer ${supabaseServiceKey}`,
      },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Supabase fetch failed (${response.status}): ${text}`);
    }
    const batch = (await response.json()) as SupabaseRow[];
    if (batch.length === 0) break;
    all.push(...batch);
    const last = batch[batch.length - 1];
    lastChangedAt = last.changed_at;
    lastId = last.id;
    if (batch.length < BATCH_SIZE) break;
  }
  return all;
}

function mapRow(row: SupabaseRow): ConvexImportEntry | null {
  const instructorSlug = row.instructor_slug?.trim().toLowerCase();
  if (!instructorSlug) return null;

  let mentorshipType: "oneOnOne" | "group" | null = null;
  if (row.mentorship_type === "one-on-one" || row.mentorship_type === "oneOnOne") {
    mentorshipType = "oneOnOne";
  } else if (row.mentorship_type === "group") {
    mentorshipType = "group";
  }
  // Null mentorship_type is valid (some manual updates apply to both
  // 1-on-1 and group in one record); only filter rows with an unknown
  // mentorship_type.

  let changeType: "manual_update" | "kajabi_purchase" | null = null;
  if (row.change_type === "manual_update") changeType = "manual_update";
  else if (row.change_type === "kajabi_purchase") changeType = "kajabi_purchase";
  if (!changeType) return null;

  const changedAtMs = row.changed_at ? Date.parse(row.changed_at) : NaN;
  if (!Number.isFinite(changedAtMs)) return null;

  return {
    instructorSlug,
    mentorshipType,
    changeType,
    oldValue: Number(row.old_value),
    newValue: Number(row.new_value),
    changedAt: changedAtMs,
  };
}

async function postBatch(
  entries: ConvexImportEntry[],
): Promise<ImportResponse> {
  const rawConvexUrl = CONVEX_URL_ENV_KEYS.map((k) => process.env[k]).find(
    Boolean,
  );
  const convexHttpKey = process.env.CONVEX_HTTP_KEY;
  if (!rawConvexUrl) {
    throw new Error(
      `Missing ${CONVEX_URL_ENV_KEYS.join(" or ")}. The script needs to know which Convex deployment to write to.`,
    );
  }
  if (!convexHttpKey) {
    throw new Error(
      "Missing CONVEX_HTTP_KEY. The /inventory-change-log/import-bulk HTTP action is gated by this bearer.",
    );
  }

  const url = `${convexSiteUrl(rawConvexUrl)}/inventory-change-log/import-bulk`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${convexHttpKey}`,
    },
    body: JSON.stringify({ entries }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Convex import failed (${response.status}): ${text}`);
  }
  return JSON.parse(text) as ImportResponse;
}

async function main(): Promise<void> {
  console.log("[migrate-inventory-change-log] reading Supabase inventory_change_log...");
  const supabaseRows = await fetchSupabaseRows();
  console.log(`[migrate-inventory-change-log] fetched ${supabaseRows.length} rows from Supabase`);

  const entries = supabaseRows
    .map(mapRow)
    .filter((e): e is ConvexImportEntry => e !== null);
  console.log(
    `[migrate-inventory-change-log] mapped ${entries.length} rows to Convex entries`,
  );

  let totalInserted = 0;
  let totalSkipped = 0;
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const result = await postBatch(batch);
    totalInserted += result.inserted;
    totalSkipped += result.skipped;
    console.log(
      `[migrate-inventory-change-log] batch ${Math.floor(i / BATCH_SIZE) + 1}: inserted=${result.inserted} skipped=${result.skipped}`,
    );
  }

  console.log(
    `[migrate-inventory-change-log] supabase import done. totalInserted=${totalInserted} totalSkipped=${totalSkipped} unmappedRows=${supabaseRows.length - entries.length}`,
  );
  console.log("[migrate-inventory-change-log] all steps complete.");
}

main().catch((error) => {
  console.error("[migrate-inventory-change-log] FAILED:", error);
  process.exit(1);
});
