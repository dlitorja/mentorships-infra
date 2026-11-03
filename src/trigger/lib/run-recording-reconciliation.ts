import {
  classifyRecordingObjects,
  type DriftItem,
  type ReconSessionRow,
  type RecordingObject,
} from "./recording-reconciliation";

/**
 * Orchestration for the weekly recordings-bucket reconciliation.
 *
 * Dependency-injected so the destructive path is testable without B2,
 * Convex or Trigger — same shape as `recording-cleanup.ts` (PR #984).
 */

export type AlertResult = "sent" | "skipped" | "failed";

export type ReconciliationSummary = {
  bucket: string;
  scanned: number;
  truncated: boolean;
  healthy: number;
  skippedInFlight: number;
  drift: number;
  purgedButPresent: number;
  orphans: number;
  expiredNotPurged: number;
  deleted: number;
  deleteFailures: string[];
  alert: AlertResult;
};

export type Logger = {
  info: (message: string, context?: Record<string, unknown>) => void;
  error: (message: string, context?: Record<string, unknown>) => void;
};

export type ListObjectsResult = {
  objects: Array<{ key: string; size: number; lastModified: Date | string | number }>;
  isTruncated: boolean;
  nextContinuationToken: string | null;
};

export type ReconciliationDeps = {
  bucket: string;
  prefix: string;
  maxListPages: number;
  now: () => number;
  log: Logger;
  fetchSessions: () => Promise<ReconSessionRow[]>;
  listObjects: (params: {
    bucket: string;
    prefix: string;
    maxKeys: number;
    continuationToken?: string;
  }) => Promise<ListObjectsResult>;
  deleteObject: (key: string) => Promise<void>;
  sendAlert: (
    summary: ReconciliationSummary,
    drift: DriftItem[]
  ) => Promise<AlertResult>;
};

function toRecordingObject(row: ListObjectsResult["objects"][number]): RecordingObject {
  return {
    key: row.key,
    size: row.size,
    lastModified:
      row.lastModified instanceof Date
        ? row.lastModified.getTime()
        : new Date(row.lastModified).getTime(),
  };
}

export async function runReconciliation(
  deps: ReconciliationDeps
): Promise<ReconciliationSummary> {
  const [sessions, listing] = await Promise.all([
    deps.fetchSessions(),
    listAllPages(deps),
  ]);

  const { drift, healthy, skippedInFlight } = classifyRecordingObjects(
    listing.objects,
    sessions,
    deps.now()
  );

  let deleted = 0;
  const deleteFailures: string[] = [];
  for (const item of drift) {
    if (!item.deletable) continue;
    try {
      await deps.deleteObject(item.key);
      deleted++;
    } catch (error) {
      deleteFailures.push(
        `${item.key}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  const summary: ReconciliationSummary = {
    bucket: deps.bucket,
    scanned: listing.objects.length,
    truncated: listing.truncated,
    healthy,
    skippedInFlight,
    drift: drift.length,
    purgedButPresent: drift.filter((d) => d.kind === "purged_but_present").length,
    orphans: drift.filter((d) => d.kind === "orphan").length,
    expiredNotPurged: drift.filter((d) => d.kind === "expired_not_purged").length,
    deleted,
    deleteFailures,
    alert: "skipped",
  };

  // One email per run, never per object.
  if (drift.length > 0) {
    summary.alert = await deps.sendAlert(summary, drift);
  }

  if (listing.truncated) {
    // Never report an incomplete scan as clean.
    deps.log.error(
      "Recordings listing was truncated — later objects were NOT checked",
      { bucket: deps.bucket, scanned: listing.objects.length, maxPages: deps.maxListPages }
    );
  }

  if (drift.length > 0) {
    deps.log.error("Recordings bucket drift detected", {
      ...summary,
      driftDetail: drift,
    });
  } else {
    deps.log.info("Recordings bucket clean", {
      scanned: summary.scanned,
      healthy,
      skippedInFlight,
    });
  }

  return summary;
}

async function listAllPages(deps: ReconciliationDeps): Promise<{
  objects: RecordingObject[];
  truncated: boolean;
}> {
  const objects: RecordingObject[] = [];
  let continuationToken: string | undefined;

  for (let page = 0; page < deps.maxListPages; page++) {
    const result = await deps.listObjects({
      bucket: deps.bucket,
      prefix: deps.prefix,
      maxKeys: 1000,
      continuationToken,
    });

    for (const row of result.objects) objects.push(toRecordingObject(row));

    if (!result.isTruncated || !result.nextContinuationToken) {
      return { objects, truncated: false };
    }
    continuationToken = result.nextContinuationToken;
  }

  // Safety bound only; the caller reports it instead of claiming a clean scan.
  return { objects, truncated: true };
}
