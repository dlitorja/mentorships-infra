import { logger } from "@trigger.dev/sdk";

const B2_STORAGE_RATE_PER_GB = 0.006;
const B2_API_COST_PER_1000 = 0.004;

export function formatBytesToGB(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  return `${gb.toFixed(2)} GB`;
}

export function formatCost(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// Note: S3 Glacier archival has been removed in favor of B2-only storage.
// All files remain on B2 hot storage ($0.006/GB/mo) for simplicity and instant access.
// The following tasks have been removed:
// - archiveOldFiles (daily cron to copy files to S3 Glacier)
// - retryFailedTransfers (retry failed S3 archival attempts)
// - sendArchiveWarnings (warn instructors before archival)
// - calculateStorageCosts (S3 Glacier cost tracking)
//
// If cost tracking is needed in the future, it can be added as a B2-only task.

export const noop = { message: "No S3 Glacier archival tasks - using B2-only storage" };