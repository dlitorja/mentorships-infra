/**
 * One-time migration: copies rows from Supabase `marketing_waitlist` into
 * Convex `marketingWaitlist` so existing subscribers remain visible after PR 6a
 * consolidated writes to the Convex table.
 *
 * Usage (from project root):
 *   CONVEX_HTTP_KEY=<key> \
 *     SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> \
 *     npx tsx scripts/migrate-marketing-waitlist.ts
 *
 * Reads `NEXT_PUBLIC_CONVEX_URL` (or `CONVEX_URL`) from the local environment to
 * resolve the Convex HTTP endpoint. Hits `POST /waitlist/import-bulk` on
 * `acoustic-kiwi-522.convex.site` (dev) or `fine-bulldog-260.convex.site` (prod)
 * in batches of 200. Idempotent: the internal mutation skips triples that
 * already exist by (email, instructorSlug, mentorshipType).
 *
 * Safe to re-run. Required secrets:
 *   - CONVEX_HTTP_KEY (Convex deployment HTTP auth)
 *   - SUPABASE_URL (default https://placeholder.supabase.co fallback not used —
 *     the script aborts if SUPABASE_SERVICE_ROLE_KEY is unset)
 *   - SUPABASE_SERVICE_ROLE_KEY
 */

const BATCH_SIZE = 200;
const CONVEX_URL_ENV_KEYS = ["CONVEX_URL", "NEXT_PUBLIC_CONVEX_URL"] as const;

type SupabaseRow = {
  id: string;
  email: string;
  instructor_slug: string;
  mentorship_type: string;
  notified: boolean;
  last_notification_at: string | null;
  created_at: string;
};

type ConvexImportEntry = {
  email: string;
  instructorSlug: string;
  mentorshipType: "oneOnOne" | "group";
  createdAt?: number;
  notifiedAt?: number;
};

type ImportResponse = {
  success: boolean;
  inserted: number;
  skipped: number;
};

type NormalizeResponse = {
  success: boolean;
  scanned: number;
  patched: number;
  deletedDuplicates: number;
  nextCursor: string | null;
  isDone: boolean;
};

function convexSiteUrl(rawUrl: string): string {
  return rawUrl.replace(/\.convex\.cloud$/, ".convex.site");
}

async function fetchSupabaseRows(): Promise<SupabaseRow[]> {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. The Supabase read needs the service-role key to enumerate all rows."
    );
  }

  const all: SupabaseRow[] = [];
  let lastCreatedAt: string | null = null;
  let lastId: string | null = null;
  while (true) {
    const url = new URL("/rest/v1/marketing_waitlist", supabaseUrl);
    url.searchParams.set("select", "id,email,instructor_slug,mentorship_type,notified,last_notification_at,created_at");
    url.searchParams.set("limit", String(BATCH_SIZE));
    // Stable keyset pagination: order by (created_at, id) and pass the
    // greatest values seen so far. Using `&` instead of `offset` means a
    // concurrent insert into marketing_waitlist during the migration
    // cannot shift the page boundaries and skip or duplicate rows.
    // Supabase (PostgREST) supports `or` filters combined with `order` for
    // this pattern.
    url.searchParams.set("order", "created_at.asc,id.asc");
    if (lastCreatedAt !== null && lastId !== null) {
      // Don't pre-encode: URLSearchParams.set applies its own percent
      // encoding. Pre-encoded values get double-encoded and the filter
      // is rejected by PostgREST, which silently returns zero rows and
      // makes later migration pages fail.
      url.searchParams.set(
        "or",
        `(created_at.gt.${lastCreatedAt},and(created_at.eq.${lastCreatedAt},id.gt.${lastId}))`
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
    lastCreatedAt = last.created_at;
    lastId = last.id;
    if (batch.length < BATCH_SIZE) break;
  }
  return all;
}

function mapRow(row: SupabaseRow): ConvexImportEntry | null {
  const email = row.email?.trim().toLowerCase();
  const instructorSlug = row.instructor_slug?.trim().toLowerCase();
  if (!email || !instructorSlug) return null;

  let mentorshipType: "oneOnOne" | "group" | null = null;
  if (row.mentorship_type === "one-on-one" || row.mentorship_type === "oneOnOne") {
    mentorshipType = "oneOnOne";
  } else if (row.mentorship_type === "group") {
    mentorshipType = "group";
  }
  if (!mentorshipType) return null;

  const createdAtMs = row.created_at ? Date.parse(row.created_at) : NaN;
  const notifiedAtMs =
    row.notified && row.last_notification_at ? Date.parse(row.last_notification_at) : NaN;
  return {
    email,
    instructorSlug,
    mentorshipType,
    createdAt: Number.isFinite(createdAtMs) ? createdAtMs : undefined,
    notifiedAt: Number.isFinite(notifiedAtMs) ? notifiedAtMs : undefined,
  };
}

async function postBatch(entries: ConvexImportEntry[]): Promise<ImportResponse> {
  const rawConvexUrl = CONVEX_URL_ENV_KEYS.map((k) => process.env[k]).find(Boolean);
  const convexHttpKey = process.env.CONVEX_HTTP_KEY;
  if (!rawConvexUrl) {
    throw new Error(`Missing ${CONVEX_URL_ENV_KEYS.join(" or ")}. The script needs to know which Convex deployment to write to.`);
  }
  if (!convexHttpKey) {
    throw new Error("Missing CONVEX_HTTP_KEY. The /waitlist/import-bulk HTTP action is gated by this bearer.");
  }

  const url = `${convexSiteUrl(rawConvexUrl)}/waitlist/import-bulk`;
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

async function postNormalizeEmails(cursor: string | null, limit: number): Promise<NormalizeResponse> {
  const rawConvexUrl = CONVEX_URL_ENV_KEYS.map((k) => process.env[k]).find(Boolean);
  const convexHttpKey = process.env.CONVEX_HTTP_KEY;
  if (!rawConvexUrl) {
    throw new Error(`Missing ${CONVEX_URL_ENV_KEYS.join(" or ")}.`);
  }
  if (!convexHttpKey) {
    throw new Error("Missing CONVEX_HTTP_KEY.");
  }

  const url = `${convexSiteUrl(rawConvexUrl)}/waitlist/normalize-emails`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${convexHttpKey}`,
    },
    body: JSON.stringify({ cursor, limit }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Convex normalize failed (${response.status}): ${text}`);
  }
  return JSON.parse(text) as NormalizeResponse;
}

async function main(): Promise<void> {
  console.log("[migrate-marketing-waitlist] reading Supabase marketing_waitlist...");
  const supabaseRows = await fetchSupabaseRows();
  console.log(`[migrate-marketing-waitlist] fetched ${supabaseRows.length} rows from Supabase`);

  const entries = supabaseRows.map(mapRow).filter((e): e is ConvexImportEntry => e !== null);
  console.log(`[migrate-marketing-waitlist] mapped ${entries.length} rows to Convex entries`);

  let totalInserted = 0;
  let totalSkipped = 0;
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const result = await postBatch(batch);
    totalInserted += result.inserted;
    totalSkipped += result.skipped;
    console.log(
      `[migrate-marketing-waitlist] batch ${Math.floor(i / BATCH_SIZE) + 1}: inserted=${result.inserted} skipped=${result.skipped}`
    );
  }

  console.log(
    `[migrate-marketing-waitlist] supabase import done. totalInserted=${totalInserted} totalSkipped=${totalSkipped} unmappedRows=${supabaseRows.length - entries.length}`
  );

  console.log("[migrate-marketing-waitlist] normalizing existing Convex emails to lowercase...");
  const NORMALIZE_PAGE_SIZE = 50;
  // Loop full passes until a pass deletes zero new duplicates. A single
  // pass is not enough when case variants of the same canonical key span
  // pages: the first-pass page keeps a row it cannot yet match to its
  // mixed-case sibling, and only a subsequent pass can reconcile them.
  // Re-running until a pass converges is idempotent and bounded — the
  // total number of rows only decreases — so this terminates.
  const MAX_NORMALIZE_PASSES = 10;
  let totalScanned = 0;
  let totalPatched = 0;
  let totalDeletedDuplicates = 0;
  for (let pass = 0; pass < MAX_NORMALIZE_PASSES; pass++) {
    let cursor: string | null = null;
    let passDeletedDuplicates = 0;
    let passScanned = 0;
    let passPatched = 0;
    for (let page = 0; ; page++) {
      const result = await postNormalizeEmails(cursor, NORMALIZE_PAGE_SIZE);
      passScanned += result.scanned;
      passPatched += result.patched;
      passDeletedDuplicates += result.deletedDuplicates;
      if (result.isDone || !result.nextCursor) break;
      cursor = result.nextCursor;
    }
    totalScanned += passScanned;
    totalPatched += passPatched;
    totalDeletedDuplicates += passDeletedDuplicates;
    console.log(
      `[migrate-marketing-waitlist] normalize pass ${pass + 1}: scanned=${passScanned} patched=${passPatched} deletedDuplicates=${passDeletedDuplicates}`
    );
    if (passDeletedDuplicates === 0) break;
  }
  console.log(
    `[migrate-marketing-waitlist] normalize done. scanned=${totalScanned} patched=${totalPatched} deletedDuplicates=${totalDeletedDuplicates}`
  );

  console.log("[migrate-marketing-waitlist] all steps complete.");
}

main().catch((error) => {
  console.error("[migrate-marketing-waitlist] FAILED:", error);
  process.exit(1);
});
