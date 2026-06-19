// S3 Glacier archival has been removed in favor of B2-only storage.
// All files remain on B2 hot storage ($0.006/GB/mo) for simplicity and instant access.
// The following scheduled tasks have been removed:
// - archiveOldFiles (daily cron to copy files to S3 Glacier)
// - retryFailedTransfers (retry failed S3 archival attempts)
// - sendArchiveWarnings (warn instructors before archival)
// - calculateStorageCosts (S3 Glacier cost tracking)
//
// If cost tracking is needed in the future, it can be added as a B2-only task.