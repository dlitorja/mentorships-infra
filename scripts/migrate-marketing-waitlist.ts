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
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. The Supabase read needs the service-role key to enumerate all rows."
    );
  }

  const all: SupabaseRow[] = [];
  let offset = 0;
  while (true) {
    const url = new URL("/rest/v1/marketing_waitlist", supabaseUrl);
    url.searchParams.set("select", "id,email,instructor_slug,mentorship_type,notified,last_notification_at,created_at");
    url.searchParams.set("limit", String(BATCH_SIZE));
    url.searchParams.set("offset", String(offset));

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
    if (batch.length < BATCH_SIZE) break;
    offset += batch.length;
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
  return {
    email,
    instructorSlug,
    mentorshipType,
    createdAt: Number.isFinite(createdAtMs) ? createdAtMs : undefined,
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

async function postNormalizeEmails(): Promise<{ success: boolean; scanned: number; patched: number }> {
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
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Convex normalize failed (${response.status}): ${text}`);
  }
  return JSON.parse(text);
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
  const normalizeResult = await postNormalizeEmails();
  console.log(
    `[migrate-marketing-waitlist] normalize done. scanned=${normalizeResult.scanned} patched=${normalizeResult.patched}`
  );

  console.log("[migrate-marketing-waitlist] all steps complete.");
}

main().catch((error) => {
  console.error("[migrate-marketing-waitlist] FAILED:", error);
  process.exit(1);
});
