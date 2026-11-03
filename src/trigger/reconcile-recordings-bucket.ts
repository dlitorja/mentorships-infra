import { logger, schedules } from "@trigger.dev/sdk";
import {
  deleteRecordingFromB2,
  getRecordingsBucketName,
  listB2Objects,
} from "@mentorships/storage";
import {
  runReconciliation,
  type AlertResult,
  type ReconciliationSummary,
} from "./lib/run-recording-reconciliation";
import type { DriftItem, ReconSessionRow } from "./lib/recording-reconciliation";

const RECORDINGS_PREFIX = "recordings/";
const SESSIONS_PATH = "/recordings-reconciliation/sessions";
const MAX_LIST_PAGES = 200;
const MAX_SESSION_PAGES = 200;

const CONVEX_DEPLOYMENT_URL = (
  process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_DEPLOYMENT_URL
)
  ?.replace(/\/+$/, "")
  // HTTP actions are served on `.convex.site`, not `.convex.cloud`.
  .replace(/\.convex\.cloud$/, ".convex.site");
const CONVEX_HTTP_KEY = process.env.CONVEX_HTTP_KEY;

/**
 * Session rows are paginated server-side: the `sessions` table grows with
 * all history, so a single unpaginated read eventually exceeds Convex's
 * per-query read limits and would fail the whole weekly job.
 */
async function fetchAllSessions(): Promise<ReconSessionRow[]> {
  if (!CONVEX_DEPLOYMENT_URL || !CONVEX_HTTP_KEY) {
    throw new Error("Convex deployment URL or HTTP key not configured");
  }

  const sessions: ReconSessionRow[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < MAX_SESSION_PAGES; page++) {
    const url = new URL(`${CONVEX_DEPLOYMENT_URL}${SESSIONS_PATH}`);
    if (cursor) url.searchParams.set("cursor", cursor);

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${CONVEX_HTTP_KEY}` },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Convex ${SESSIONS_PATH} failed: ${response.status} ${text.slice(0, 200)}`
      );
    }

    const body = (await response.json()) as {
      sessions?: ReconSessionRow[];
      isDone?: boolean;
      continueCursor?: string | null;
    };
    sessions.push(...(body.sessions ?? []));

    if (body.isDone !== false || !body.continueCursor) return sessions;
    cursor = body.continueCursor;
  }

  throw new Error(
    `Session pagination exceeded ${MAX_SESSION_PAGES} pages — refusing to reconcile with a partial session set`
  );
}

async function sendAlert(
  summary: ReconciliationSummary,
  drift: DriftItem[]
): Promise<AlertResult> {
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
 * `unauthorized`), while the S3-compatible API — used here through
 * `@mentorships/storage` — works and is already the path the retention
 * cleanup relies on.
 *
 * See `./lib/recording-reconciliation.ts` for the classification rules
 * and why Event Notifications would not catch this class of drift.
 */
export const reconcileRecordingsBucket = schedules.task({
  id: "reconcile-recordings-bucket",
  cron: "0 6 * * 0",
  maxDuration: 1800,
  run: async (payload): Promise<ReconciliationSummary> => {
    const bucket = getRecordingsBucketName();
    logger.info("Starting recordings-bucket reconciliation", {
      bucket,
      timestamp: payload.timestamp,
      lastTimestamp: payload.lastTimestamp,
    });

    const summary = await runReconciliation({
      bucket,
      prefix: RECORDINGS_PREFIX,
      maxListPages: MAX_LIST_PAGES,
      now: () => Date.now(),
      log: logger,
      fetchSessions: fetchAllSessions,
      listObjects: (params) => listB2Objects(params),
      deleteObject: (key) => deleteRecordingFromB2(key),
      sendAlert,
    });

    return summary;
  },
});
