/**
 * Backblaze B2 cost model.
 *
 * Rates verified against https://www.backblaze.com/cloud-storage/pricing
 * on 2026-11-02:
 *
 *   - Storage: **$6.95/TB/month** (`$0.00695/GB/month`, billed per
 *     byte-hour). The first 10 GB of storage is free.
 *   - **Class A, B and C API calls are free** for pay-as-you-go
 *     customers (uploads, downloads, listings, bucket/key management).
 *   - **Class D** (Event Notification outbound calls) costs
 *     `$0.004 per 10,000` calls after the first 2,500 calls/day.
 *   - **Egress:** free up to 3x average monthly stored data, then
 *     `$0.01/GB`. Egress through a Bandwidth Alliance partner (e.g.
 *     Cloudflare) is free and unlimited, but only when the bytes
 *     actually traverse the partner; a Worker that merely redirects
 *     to a signed B2 URL does not qualify.
 *
 * Do NOT reintroduce the pre-May-2026 figures (`$0.006/GB`,
 * `$0.004/1,000` Class A, `$0.002/1,000` Class B). They no longer
 * match published pricing and silently overstate transaction cost
 * while understating storage cost.
 *
 * Cite the pricing page. The separate transaction-pricing page still
 * carries a stale "$0.005/GB/month" footnote in its Class A section.
 *
 * Every helper below returns **cents**, matching `StorageCosts`.
 */

/** $6.95/TB/month expressed per GB. */
export const B2_STORAGE_RATE_PER_GB = 0.00695;

/** B2 gives the first 10 GB of stored data away. */
export const B2_FREE_STORAGE_GB = 10;

/** Overage rate once egress exceeds the free multiple. */
export const B2_EGRESS_RATE_PER_GB = 0.01;

/** Free egress allowance, as a multiple of average monthly stored data. */
export const B2_FREE_EGRESS_MULTIPLE = 3;

/** Class D (Event Notification) rate, per 10,000 outbound calls. */
export const B2_CLASS_D_RATE_PER_10000 = 0.004;

/** Class D calls that are free each day. */
export const B2_CLASS_D_FREE_PER_DAY = 2500;

const BYTES_PER_GB = 1024 * 1024 * 1024;

export interface StorageCosts {
  b2Storage: number;
  b2Download: number;
  b2Api: number;
  total: number;
  month: string;
}

function bytesToGb(bytes: number): number {
  return bytes / BYTES_PER_GB;
}

/**
 * Estimated storage cost for a given byte count, in cents.
 * Applies the 10 GB free allowance.
 */
export function estimateB2StorageCost(bytes: number): number {
  const billableGb = Math.max(0, bytesToGb(bytes) - B2_FREE_STORAGE_GB);
  return Math.round(billableGb * B2_STORAGE_RATE_PER_GB * 100);
}

/**
 * Estimated egress cost in cents. Egress is free until it exceeds
 * `B2_FREE_EGRESS_MULTIPLE`x the average stored bytes for the month.
 */
export function estimateB2EgressCost(
  storedBytes: number,
  egressBytes: number
): number {
  const freeEgressBytes = storedBytes * B2_FREE_EGRESS_MULTIPLE;
  const billableBytes = Math.max(0, egressBytes - freeEgressBytes);
  return Math.round(bytesToGb(billableBytes) * B2_EGRESS_RATE_PER_GB * 100);
}

/**
 * Estimated Class D (Event Notification) cost in cents.
 *
 * Pass the **per-day** call counts, not a monthly total: the 2,500/day
 * free allowance resets daily, so 75,000 calls on a single day costs
 * money even though it is below `2,500 x 31`. Pooling them would report
 * zero.
 */
export function calculateNotificationTransactionCost(
  callsByDay: readonly number[]
): number {
  const billableCalls = callsByDay.reduce(
    (sum, calls) => sum + Math.max(0, calls - B2_CLASS_D_FREE_PER_DAY),
    0
  );
  return Math.round(
    (billableCalls / 10000) * B2_CLASS_D_RATE_PER_10000 * 100
  );
}

/**
 * Class A and Class B API calls are free as of 2026-05. Kept as
 * named helpers so callers do not have to hardcode `0` and so the
 * reason is discoverable at the call site.
 */
export function calculateUploadTransactionCost(_uploadCount: number): number {
  return 0;
}

export function calculateDownloadTransactionCost(_downloadCount: number): number {
  return 0;
}

/**
 * Live monthly cost is **not implemented**.
 *
 * Backblaze exposes no public billing or usage API, so there is no
 * honest way to fetch this. The previous implementation returned an
 * object of zeros, which rendered as `$0.00` on the admin dashboard
 * and was indistinguishable from "we are spending nothing". Returning
 * `null` forces callers to render an explicit "not measured" state.
 *
 * To produce a real number, record the invoice totals monthly via
 * `convex/monthlyStorageCosts.ts:migrateMonthlyStorageCost`. Stored
 * GB is derivable from the bucket (sum `contentLength` over
 * `b2_list_file_names`); only egress actually requires the invoice.
 */
export async function fetchMonthlyCosts(): Promise<StorageCosts | null> {
  return null;
}

export async function checkCostThreshold(
  currentCosts: number,
  thresholdCents: number = 5000
): Promise<boolean> {
  return currentCosts > thresholdCents;
}

export function formatCost(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatBytesToGB(bytes: number): string {
  const gb = bytesToGb(bytes);
  return `${gb.toFixed(2)} GB`;
}
