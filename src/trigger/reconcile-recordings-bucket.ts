import { logger, schedules } from "@trigger.dev/sdk";
import {
  deleteRecordingFromB2,
  getRecordingsBucketName,
  listB2Objects,
} from "@mentorships/storage";
import {
  classifyRecordingObjects,
  type DriftItem,
  type ReconSessionRow,
  type RecordingObject,
} from "./lib/recording-reconciliation";

const RECORDINGS_PREFIX = "recordings/";
const SESSIONS_PATH = "/recordings-reconciliation/sessions";
const MAX_LIST_PAGES = 200;

const CONVEX_DEPLOYMENT_URL = (
  process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_DEPLOYMENT_URL
)
  ?.replace(/\/+$/, "")
  // HTTP actions are served on `.convex.site`, not `.convex.cloud`.
  .replace(/\.convex\.cloud$/, ".convex.site");
const CONVEX_HTTP_KEY = process.env.CONVEX_HTTP_KEY;

type Summary = {
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
  alert: "sent" | "skipped" | "failed";
};

async function fetchSessions(): Promise<ReconSessionRow[]> {
  if (!CONVEX_DEPLOYMENT_URL || !CONVEX_HTTP_KEY) {
    throw new Error("Convex deployment URL or HTTP key not configured");
  }
  const response = await fetch(`${CONVEX_DEPLOYMENT_URL}${SESSIONS_PATH}`, {
    headers: { Authorization: `Bearer ${CONVEX_HTTP_KEY}` },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Convex ${SESSIONS_PATH} failed: ${response.status} ${text.slice(0, 200)}`
    );
  }
  const body = (await response.json()) as { sessions?: ReconSessionRow[] };
  return body.sessions ?? [];
}

async function listRecordings(bucket: string): Promise<{
  objects: RecordingObject[];
  truncated: boolean;
}> {
  const objects: RecordingObject[] = [];
  let continuationToken: string | undefined;

  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const result = await listB2Objects({
      bucket,
      prefix: RECORDINGS_PREFIX,
      maxKeys: 1000,
      continuationToken,
    });

    for (const object of result.objects) {
      objects.push({
        key: object.key,
        size: object.size,
        lastModified: new Date(object.lastModified).getTime(),
      });
    }

    if (!result.isTruncated || !result.nextContinuationToken) {
      return { objects, truncated: false };
    }
    continuationToken = result.nextContinuationToken;
  }

  // Safety bound only; report it rather than silently claiming a clean scan.
  return { objects, truncated: true };
}

async function sendAlert(summary: Summary, drift: DriftItem[]): Promise<Summary["alert"]> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM_TRANSACTIONAL ?? process.env.EMAIL_FROM;
  const to =
    process.env.RECORDING_RECONCILIATION_ALERT_EMAIL ??
    process.env.EMAIL_REPLY_TO ??
    process.env.EMAIL_FROM;

  if (!apiKey || !from || !to) return "skipped";

  const text = [
    `Recordings bucket reconciliation found ${drift.length} drift item(s) out of ${summary.scanned} object(s).`,
    `Deleted this run: ${summary.deleted}.`,
    summary.deleteFailures.length > 0
      ? `Delete failures: ${summary.deleteFailures.length}`
      : "",
    "",
    ...drift.map(
      (item) =>
        `${item.kind}: ${item.key} (${(item.bytes / 1024 ** 2).toFixed(1)} MB, ${item.deletable ? "deletable" : "report only"}) — ${item.reason}`
    ),
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject: `[recordings] ${drift.length} drift item(s) in the recordings bucket`,
        text,
      }),
    });
    return response.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

/**
 * Weekly reconciliation between the recordings bucket and `sessions`.
 *
 * Lives in Trigger rather than Convex because the Convex deployment's B2
 * key cannot use the native API (`b2_list_file_names` → 401
 * `unauthorized`), while the S3-compatible API — which this task uses
 * through `@mentorships/storage` — works there and is already the path
 * the retention cleanup relies on.
 *
 * See `./lib/recording-reconciliation.ts` for the classification rules
 * and why Event Notifications would not catch this class of drift.
 */
export const reconcileRecordingsBucket = schedules.task({
  id: "reconcile-recordings-bucket",
  cron: "0 6 * * 0",
  maxDuration: 1800,
  run: async (payload): Promise<Summary> => {
    const bucket = getRecordingsBucketName();
    logger.info("Starting recordings-bucket reconciliation", {
      bucket,
      timestamp: payload.timestamp,
      lastTimestamp: payload.lastTimestamp,
    });

    const [sessions, listing] = await Promise.all([
      fetchSessions(),
      listRecordings(bucket),
    ]);

    const now = Date.now();
    const { drift, healthy, skippedInFlight } = classifyRecordingObjects(
      listing.objects,
      sessions,
      now
    );

    let deleted = 0;
    const deleteFailures: string[] = [];
    for (const item of drift) {
      if (!item.deletable) continue;
      try {
        await deleteRecordingFromB2(item.key);
        deleted++;
      } catch (error) {
        deleteFailures.push(
          `${item.key}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    const summary: Summary = {
      bucket,
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

    if (drift.length > 0) summary.alert = await sendAlert(summary, drift);

    if (listing.truncated) {
      // Never report an incomplete scan as clean.
      logger.error("Recordings listing was truncated — later objects were NOT checked", {
        bucket,
        scanned: listing.objects.length,
        maxPages: MAX_LIST_PAGES,
      });
    }

    if (drift.length > 0) {
      logger.error("Recordings bucket drift detected", {
        ...summary,
        driftDetail: drift,
      });
    } else {
      logger.info("Recordings bucket clean", {
        scanned: summary.scanned,
        healthy,
        skippedInFlight,
      });
    }

    return summary;
  },
});
