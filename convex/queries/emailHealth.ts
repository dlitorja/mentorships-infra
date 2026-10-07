import { query } from "../_generated/server";
import { v } from "convex/values";

const DAY_MS = 24 * 60 * 60 * 1000;
const SCAN_CAP = 5_000;
const RECENT_LIMIT = 100;

const BOUNCE_RED_THRESHOLD = 100;
const COMPLAINT_RED_THRESHOLD = 25;
const UNSUBSCRIBE_RED_THRESHOLD = 200;

// PR Metrics 3b: divergence between API-aggregated counts (volume
// baseline from `dailyEmailMetrics`) and webhook-aggregated counts
// (ground truth from `suppressionEvents`). A >10% gap means the
// daily API ingestion missed events that the webhook captured —
// either the Resend API was stale when we polled OR the webhook
// deliverability replay is outpacing the API. Either way, the
// admin should know. >25% is red; >10% is yellow.
const DIVERGENCE_RED_THRESHOLD = 25;
const DIVERGENCE_YELLOW_THRESHOLD = 10;

// Overlay-only safety guards. The overlay scans suppressionEvents
// for every day in the window and per-day bins the counts, so a
// `take()` cap would silently drop the oldest days and falsely mark
// them as zero webhook events — pushing divergence to 100% and the
// severity to red. We instead `collect()` and surface a high-water
// warning if the window has more rows than the high-water guard.
const OVERLAY_HIGH_WATER = 50_000;

export const getEmailHealthSummary = query({
  args: {
    windowDays: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Authentication required");
    }
    const userByUserId = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    const userByClerkId = userByUserId
      ? null
      : await ctx.db
          .query("users")
          .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
          .first();
    const viewer = userByUserId ?? userByClerkId;
    if (!viewer || viewer.role !== "admin") {
      throw new Error("Administrator role required");
    }

    const windowDays = Math.max(1, Math.min(args.windowDays, 90));
    const cutoff = Date.now() - windowDays * DAY_MS;

    const recent = await ctx.db
      .query("suppressionEvents")
      .withIndex("by_dashboardRelevant_and_occurredAt", (q) =>
        q.eq("dashboardRelevant", true).gte("occurredAt", cutoff),
      )
      .order("desc")
      .take(SCAN_CAP);

    const byDomain = new Map<
      string,
      {
        domain: string;
        bounces: number;
        complaints: number;
        unsubscribes: number;
        removed: number;
        firstOccurredAt: number;
        lastOccurredAt: number;
        sampleEmails: string[];
      }
    >();

    for (const row of recent) {
      const bucket = byDomain.get(row.domain) ?? {
        domain: row.domain,
        bounces: 0,
        complaints: 0,
        unsubscribes: 0,
        removed: 0,
        firstOccurredAt: row.occurredAt,
        lastOccurredAt: row.occurredAt,
        sampleEmails: [],
      };
      if (row.kind === "bounce") bucket.bounces += 1;
      else if (row.kind === "complaint") bucket.complaints += 1;
      else if (row.kind === "unsubscribe") bucket.unsubscribes += 1;
      else bucket.removed += 1;
      if (row.occurredAt < bucket.firstOccurredAt)
        bucket.firstOccurredAt = row.occurredAt;
      if (row.occurredAt > bucket.lastOccurredAt)
        bucket.lastOccurredAt = row.occurredAt;
      if (bucket.sampleEmails.length < 5) bucket.sampleEmails.push(row.email);
      byDomain.set(row.domain, bucket);
    }

    const domains = Array.from(byDomain.values()).map((b) => {
      const severity = severityFor(b);
      return { ...b, severity };
    });

    domains.sort((a, b) => {
      const sevOrder = { red: 0, yellow: 1, green: 2 } as const;
      if (sevOrder[a.severity] !== sevOrder[b.severity]) {
        return sevOrder[a.severity] - sevOrder[b.severity];
      }
      return (
        b.bounces +
        b.complaints +
        b.unsubscribes -
        (a.bounces + a.complaints + a.unsubscribes)
      );
    });

    const recentEvents = recent.slice(0, RECENT_LIMIT).map((e) => ({
      kind: e.kind,
      email: e.email,
      domain: e.domain,
      resendId: e.resendId,
      bounceType: e.bounceType ?? null,
      reason: e.reason ?? null,
      occurredAt: e.occurredAt,
    }));

    const totals = domains.reduce(
      (acc, d) => ({
        bounces: acc.bounces + d.bounces,
        complaints: acc.complaints + d.complaints,
        unsubscribes: acc.unsubscribes + d.unsubscribes,
        removed: acc.removed + d.removed,
        domains: acc.domains + 1,
      }),
      { bounces: 0, complaints: 0, unsubscribes: 0, removed: 0, domains: 0 },
    );

    const denied = await ctx.db.query("deniedDomains").collect();

    return {
      windowDays,
      scannedRows: recent.length,
      scanCap: SCAN_CAP,
      truncated: recent.length === SCAN_CAP,
      totals,
      domains,
      recentEvents,
      deniedDomains: denied.map((d) => ({
        domain: d.domain,
        firstDeniedAt: d.firstDeniedAt,
        lastDeniedAt: d.lastDeniedAt,
        kind: d.kind,
        note: d.note ?? null,
        acknowledgedAt: d.acknowledgedAt ?? null,
        acknowledgedByUserId: d.acknowledgedByUserId ?? null,
      })),
    };
  },
});

function severityFor(bucket: {
  bounces: number;
  complaints: number;
  unsubscribes: number;
}): "red" | "yellow" | "green" {
  const isRed =
    bucket.bounces >= BOUNCE_RED_THRESHOLD ||
    bucket.complaints >= COMPLAINT_RED_THRESHOLD ||
    bucket.unsubscribes >= UNSUBSCRIBE_RED_THRESHOLD;
  if (isRed) return "red";
  const isYellow =
    bucket.bounces >= Math.floor(BOUNCE_RED_THRESHOLD / 2) ||
    bucket.complaints >= Math.floor(COMPLAINT_RED_THRESHOLD / 2) ||
    bucket.unsubscribes >= Math.floor(UNSUBSCRIBE_RED_THRESHOLD / 2);
  if (isYellow) return "yellow";
  return "green";
}

// PR Metrics 3b — overlay metrics on the dashboard tile.
//
// Combines the per-day batched counts from `dailyEmailMetrics` (PR 3a,
// volume baseline from the Resend API) with the per-event counts from
// `suppressionEvents` (PR 2a, ground truth from the Svix webhook).
// The two should be roughly equal over a 24-hour window; if they
// diverge by more than 10% we flag the day as yellow, by more than
// 25% as red. The dashboard tile also gets a per-day chart with
// the API counts as the rendered series — admins see both the
// shape of volume AND the consistency check at a glance.
//
// Date format: the table stores `date` as YYYY-MM-DD (UTC, as
// emitted by the Resend API and the 2c reconcile cron). The
// suppressionEvents scan uses `occurredAt` in epoch ms; we
// convert ms back to YYYY-MM-DD using UTC so the two sources
// align on the day boundary.
export const getEmailMetricsOverlay = query({
  args: {
    windowDays: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Authentication required");
    }
    const userByUserId = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    const userByClerkId = userByUserId
      ? null
      : await ctx.db
          .query("users")
          .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
          .first();
    const viewer = userByUserId ?? userByClerkId;
    if (!viewer || viewer.role !== "admin") {
      throw new Error("Administrator role required");
    }

    const windowDays = Math.max(1, Math.min(args.windowDays, 30));
    const todayUtc = isoDateUtc(Date.now());
    const dates: string[] = [];
    for (let i = windowDays - 1; i >= 0; i--) {
      dates.push(addDaysIso(todayUtc, -i));
    }
    const earliestMs = parseIsoDateUtc(dates[0]);

    // Pull every `dailyEmailMetrics` row in the window once. The
    // table has at most one row per (date, audienceId?, kind) but
    // many rows in the window — take with a generous cap and group
    // in-memory per date. PR 3a writes rows from the Resend API
    // with `source: "api"`; PR 2c's reconcile cron (and a future
    // PR 3c webhook reconcile) writes `source: "webhook_reconcile"`.
    // Both land in the same table — we sum across sources per
    // (date, kind) since they describe the same underlying daily
    // count from different ingestion paths.
    const metricsRows = await ctx.db
      .query("dailyEmailMetrics")
      .withIndex("by_date", (q) => q.gte("date", dates[0]))
      .collect();

    const metricsByDate = new Map<
      string,
      {
        delivery: number;
        bounce: number;
        complaint: number;
        open: number;
        click: number;
        latestIngestedAt: number;
      }
    >();
    for (const row of metricsRows) {
      const bucket = metricsByDate.get(row.date) ?? {
        delivery: 0,
        bounce: 0,
        complaint: 0,
        open: 0,
        click: 0,
        latestIngestedAt: 0,
      };
      if (row.kind === "delivery") bucket.delivery += row.count;
      else if (row.kind === "bounce") bucket.bounce += row.count;
      else if (row.kind === "complaint") bucket.complaint += row.count;
      else if (row.kind === "open") bucket.open += row.count;
      else if (row.kind === "click") bucket.click += row.count;
      if (row.ingestedAt > bucket.latestIngestedAt)
        bucket.latestIngestedAt = row.ingestedAt;
      metricsByDate.set(row.date, bucket);
    }

    // Pull suppression events in the same window. We use `.take()`
    // (not `take(SCAN_CAP)` like `getEmailHealthSummary`) so the
    // oldest days in the window are not silently dropped — if
    // they were, the per-day divergence would compute against a
    // zero baseline and falsely flag every old day as red. The
    // high-water cap is sized for an admin-only query against a
    // 30-day window with worst-case pathological suppression
    // volume; anything above it is surfaced as a warning in
    // `sources` (and the admin should narrow the window).
    // `.take(N + 1)` is the standard "detect truncation without
    // losing data" trick: if we get N+1 rows back, we know there
    // are more and surface the warning; otherwise we got exactly
    // what was there.
    const allScanRows = await ctx.db
      .query("suppressionEvents")
      .withIndex("by_dashboardRelevant_and_occurredAt", (q) =>
        q.eq("dashboardRelevant", true).gte("occurredAt", earliestMs),
      )
      .order("desc")
      .take(OVERLAY_HIGH_WATER + 1);
    const webhookHighWaterExceeded = allScanRows.length > OVERLAY_HIGH_WATER;
    const suppressionRows = webhookHighWaterExceeded
      ? allScanRows.slice(0, OVERLAY_HIGH_WATER)
      : allScanRows;

    const suppressionsByDate = new Map<
      string,
      {
        bounces: number;
        complaints: number;
        unsubscribes: number;
        removed: number;
        total: number;
      }
    >();
    // Dedup key: a single underlying suppression event lands in
    // BOTH the Svix webhook (`event:<delivery_id>`) and the
    // periodic suppression-list scan (`list:<entry_id>`) — same
    // email, same kind, same UTC day, but different resendId so
    // `upsertSuppressionEvent` does not collapse them. We count
    // each (email, kind, day) once so a day whose counts agree
    // does not get a false yellow/red from the duplicate.
    const seenByDate = new Map<string, Set<string>>();
    for (const row of suppressionRows) {
      const date = isoDateUtc(row.occurredAt);
      let seen = seenByDate.get(date);
      if (!seen) {
        seen = new Set();
        seenByDate.set(date, seen);
      }
      const dedupKey = `${row.email}|${row.kind}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      const bucket = suppressionsByDate.get(date) ?? {
        bounces: 0,
        complaints: 0,
        unsubscribes: 0,
        removed: 0,
        total: 0,
      };
      if (row.kind === "bounce") bucket.bounces += 1;
      else if (row.kind === "complaint") bucket.complaints += 1;
      else if (row.kind === "unsubscribe") bucket.unsubscribes += 1;
      else bucket.removed += 1;
      bucket.total += 1;
      suppressionsByDate.set(date, bucket);
    }

    // When the scan hit the high-water cap, the rows we have are
    // the newest 50,000 in the window. The oldest row we have
    // defines a floor: any day older than it has no observable
    // webhook events in our scan (some may exist beyond the cap).
    // We mark those days "unknown" rather than falsely red — the
    // admin sees they need to narrow the window.
    const oldestScannedDay: string | null =
      suppressionRows.length > 0
        ? isoDateUtc(suppressionRows[suppressionRows.length - 1].occurredAt)
        : null;

    const byDate = dates.map((date) => {
      const api = metricsByDate.get(date) ?? {
        delivery: 0,
        bounce: 0,
        complaint: 0,
        open: 0,
        click: 0,
        latestIngestedAt: 0,
      };
      const webhook = suppressionsByDate.get(date) ?? {
        bounces: 0,
        complaints: 0,
        unsubscribes: 0,
        removed: 0,
        total: 0,
      };

      const isUnknownDay =
        webhookHighWaterExceeded &&
        oldestScannedDay !== null &&
        date < oldestScannedDay;

      const apiBounceComplaint = api.bounce + api.complaint;
      const webhookBounceComplaint = webhook.bounces + webhook.complaints;
      const divergencePct = isUnknownDay
        ? 0
        : apiBounceComplaint === 0 && webhookBounceComplaint === 0
          ? 0
          : Math.round(
              (Math.abs(apiBounceComplaint - webhookBounceComplaint) /
                Math.max(apiBounceComplaint, webhookBounceComplaint, 1)) *
                100,
            );

      // Severity is "unknown" when the scan was truncated and
      // this day is older than the oldest day we have rows for.
      // Showing a confident green/yellow/red would be misleading
      // — the admin sees "unknown" and knows to narrow the
      // window or wait for the next cron pass.
      const severity: "red" | "yellow" | "green" | "unknown" = isUnknownDay
        ? "unknown"
        : apiBounceComplaint === 0 && webhookBounceComplaint === 0
          ? "green"
          : divergencePct >= DIVERGENCE_RED_THRESHOLD
            ? "red"
            : divergencePct >= DIVERGENCE_YELLOW_THRESHOLD
              ? "yellow"
              : "green";

      return {
        date,
        delivery: api.delivery,
        bounce: api.bounce,
        complaint: api.complaint,
        open: api.open,
        click: api.click,
        webhookBounces: webhook.bounces,
        webhookComplaints: webhook.complaints,
        webhookUnsubscribes: webhook.unsubscribes,
        webhookRemoved: webhook.removed,
        webhookTotal: webhook.total,
        divergencePct,
        severity,
        openRate:
          api.delivery > 0
            ? Math.round((api.open / api.delivery) * 10000) / 100
            : 0,
        clickRate:
          api.delivery > 0
            ? Math.round((api.click / api.delivery) * 10000) / 100
            : 0,
        bounceRate:
          api.delivery > 0
            ? Math.round((api.bounce / api.delivery) * 10000) / 100
            : 0,
        complaintRate:
          api.delivery > 0
            ? Math.round((api.complaint / api.delivery) * 10000) / 100
            : 0,
      };
    });

    const totals = byDate.reduce(
      (acc, d) => ({
        apiDelivery: acc.apiDelivery + d.delivery,
        apiBounce: acc.apiBounce + d.bounce,
        apiComplaint: acc.apiComplaint + d.complaint,
        apiOpen: acc.apiOpen + d.open,
        apiClick: acc.apiClick + d.click,
        webhookBounces: acc.webhookBounces + d.webhookBounces,
        webhookComplaints: acc.webhookComplaints + d.webhookComplaints,
        webhookUnsubscribes: acc.webhookUnsubscribes + d.webhookUnsubscribes,
        webhookRemoved: acc.webhookRemoved + d.webhookRemoved,
        webhookTotal: acc.webhookTotal + d.webhookTotal,
        divergentDays:
          acc.divergentDays +
          (d.divergencePct >= DIVERGENCE_YELLOW_THRESHOLD ? 1 : 0),
        redDays: acc.redDays + (d.severity === "red" ? 1 : 0),
      }),
      {
        apiDelivery: 0,
        apiBounce: 0,
        apiComplaint: 0,
        apiOpen: 0,
        apiClick: 0,
        webhookBounces: 0,
        webhookComplaints: 0,
        webhookUnsubscribes: 0,
        webhookRemoved: 0,
        webhookTotal: 0,
        divergentDays: 0,
        redDays: 0,
      },
    );

    const lastIngestedAt = metricsRows.reduce(
      (max, r) => (r.ingestedAt > max ? r.ingestedAt : max),
      0,
    );

    return {
      windowDays,
      byDate,
      totals,
      sources: {
        apiLatestIngestedAt: lastIngestedAt,
        webhookScannedRows: suppressionRows.length,
        webhookHighWater: OVERLAY_HIGH_WATER,
        webhookHighWaterExceeded,
      },
    };
  },
});

function isoDateUtc(ms: number): string {
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear().toString().padStart(4, "0");
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = d.getUTCDate().toString().padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysIso(isoDate: string, deltaDays: number): string {
  const ms = parseIsoDateUtc(isoDate);
  return isoDateUtc(ms + deltaDays * DAY_MS);
}

function parseIsoDateUtc(isoDate: string): number {
  const [yyyy, mm, dd] = isoDate.split("-").map((n) => parseInt(n, 10));
  return Date.UTC(yyyy, mm - 1, dd);
}
