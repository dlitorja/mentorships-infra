import { query } from "../_generated/server";
import { v } from "convex/values";

const DAY_MS = 24 * 60 * 60 * 1000;
const SCAN_CAP = 5_000;
const RECENT_LIMIT = 100;

const BOUNCE_RED_THRESHOLD = 100;
const COMPLAINT_RED_THRESHOLD = 25;
const UNSUBSCRIBE_RED_THRESHOLD = 200;

export const getEmailHealthSummary = query({
  args: {
    windowDays: v.number(),
  },
  handler: async (ctx, args) => {
    const windowDays = Math.max(1, Math.min(args.windowDays, 90));
    const cutoff = Date.now() - windowDays * DAY_MS;

    const recent = await ctx.db
      .query("suppressionEvents")
      .withIndex("by_occurredAt", (q) => q.gte("occurredAt", cutoff))
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
      const bucket =
        byDomain.get(row.domain) ??
        {
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
      if (row.occurredAt < bucket.firstOccurredAt) bucket.firstOccurredAt = row.occurredAt;
      if (row.occurredAt > bucket.lastOccurredAt) bucket.lastOccurredAt = row.occurredAt;
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
      return b.bounces + b.complaints + b.unsubscribes - (a.bounces + a.complaints + a.unsubscribes);
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
      { bounces: 0, complaints: 0, unsubscribes: 0, removed: 0, domains: 0 }
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
