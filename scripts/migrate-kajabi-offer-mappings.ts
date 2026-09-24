/**
 * One-time migration: copies rows from Supabase `kajabi_offer_mappings`
 * into the new Convex `kajabiOfferMappings` table so the Kajabi webhook
 * (HUC-41 PR) can read the mapping from Convex without touching Supabase.
 *
 * Usage (from project root):
 *   CONVEX_HTTP_KEY=<key> \
 *     SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> \
 *     npx tsx scripts/migrate-kajabi-offer-mappings.ts
 *
 * Reads `NEXT_PUBLIC_CONVEX_URL` (or `CONVEX_URL`) from the local
 * environment to resolve the Convex HTTP endpoint. Hits `POST
 * /kajabi-offer-mappings/import-bulk` on the dev or prod deployment.
 *
 * Idempotency: every entry carries a `legacyId` equal to the
 * Supabase row's UUID primary key. The receiving internal mutation
 * (`convex/digest.ts:internalBulkImportKajabiOfferMappings`) dedups
 * by `legacyId` so re-runs are safe.
 *
 * Required secrets:
 *   - CONVEX_HTTP_KEY (Convex deployment HTTP auth)
 *   - SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 */

const BATCH_SIZE = 200;
const CONVEX_URL_ENV_KEYS = ["CONVEX_URL", "NEXT_PUBLIC_CONVEX_URL"] as const;
import { z } from "zod";

const SUPABASE_ROW_SCHEMA = z.object({
  id: z.string(),
  offer_id: z.string(),
  instructor_slug: z.string(),
  mentorship_type: z.string(),
  kajabi_offer_url: z.string(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
});
type SupabaseRow = z.infer<typeof SUPABASE_ROW_SCHEMA>;

type ConvexImportEntry = {
  offerId: string;
  instructorSlug: string;
  mentorshipType: "one-on-one" | "group";
  kajabiOfferUrl: string;
  createdAt: number;
  updatedAt: number;
  legacyId: string;
};

const IMPORT_RESPONSE_SCHEMA = z.object({
  success: z.boolean(),
  inserted: z.number(),
  skipped: z.number(),
});

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
  let lastId: string | null = null;
  while (true) {
    const url = new URL("/rest/v1/kajabi_offer_mappings", supabaseUrl);
    url.searchParams.set(
      "select",
      "id,offer_id,instructor_slug,mentorship_type,kajabi_offer_url,created_at,updated_at",
    );
    url.searchParams.set("limit", String(BATCH_SIZE));
    url.searchParams.set("order", "id.asc");
    if (lastId !== null) {
      url.searchParams.set("id", `gt.${lastId}`);
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
    const batchRaw = (await response.json()) as unknown[];
    const batch = batchRaw.map((row) => {
      const parsed = SUPABASE_ROW_SCHEMA.safeParse(row);
      if (!parsed.success) {
        throw new Error(
          `Supabase returned a row that did not match the expected shape: ${JSON.stringify(parsed.error.format())}`,
        );
      }
      return parsed.data;
    });
    if (batch.length === 0) break;
    all.push(...batch);
    const last = batch[batch.length - 1];
    lastId = last.id;
    if (batch.length < BATCH_SIZE) break;
  }
  return all;
}

function mapRow(row: SupabaseRow): ConvexImportEntry | null {
  if (row.mentorship_type !== "one-on-one" && row.mentorship_type !== "group") {
    return null;
  }
  const createdAtMs = row.created_at ? Date.parse(row.created_at) : NaN;
  const updatedAtMs = row.updated_at ? Date.parse(row.updated_at) : NaN;
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(updatedAtMs)) {
    return null;
  }
  return {
    offerId: row.offer_id,
    instructorSlug: row.instructor_slug.trim().toLowerCase(),
    mentorshipType: row.mentorship_type,
    kajabiOfferUrl: row.kajabi_offer_url,
    createdAt: createdAtMs,
    updatedAt: updatedAtMs,
    legacyId: row.id,
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
      "Missing CONVEX_HTTP_KEY. The /kajabi-offer-mappings/import-bulk HTTP action is gated by this bearer.",
    );
  }

  const url = `${convexSiteUrl(rawConvexUrl)}/kajabi-offer-mappings/import-bulk`;
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
  const parsed = IMPORT_RESPONSE_SCHEMA.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new Error(
      `Convex import returned a response that did not match the expected shape: ${JSON.stringify(parsed.error.format())}`,
    );
  }
  return parsed.data;
}

async function main(): Promise<void> {
  console.log("[migrate-kajabi-offer-mappings] reading Supabase kajabi_offer_mappings...");
  const supabaseRows = await fetchSupabaseRows();
  console.log(`[migrate-kajabi-offer-mappings] fetched ${supabaseRows.length} rows from Supabase`);

  const entries = supabaseRows
    .map(mapRow)
    .filter((e): e is ConvexImportEntry => e !== null);
  console.log(
    `[migrate-kajabi-offer-mappings] mapped ${entries.length} rows to Convex entries`,
  );

  let totalInserted = 0;
  let totalSkipped = 0;
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const result = await postBatch(batch);
    totalInserted += result.inserted;
    totalSkipped += result.skipped;
    console.log(
      `[migrate-kajabi-offer-mappings] batch ${Math.floor(i / BATCH_SIZE) + 1}: inserted=${result.inserted} skipped=${result.skipped}`,
    );
  }

  console.log(
    `[migrate-kajabi-offer-mappings] supabase import done. totalInserted=${totalInserted} totalSkipped=${totalSkipped} unmappedRows=${supabaseRows.length - entries.length}`,
  );
  console.log("[migrate-kajabi-offer-mappings] all steps complete.");
}

main().catch((error) => {
  console.error("[migrate-kajabi-offer-mappings] FAILED:", error);
  process.exit(1);
});
