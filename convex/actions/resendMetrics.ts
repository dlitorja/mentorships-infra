"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";

const RESEND_METRICS_URL = "https://api.resend.com/emails/metrics";
const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;

type ResendMetricsRow = {
  period?: string;
  date?: string;
  delivered?: number;
  bounced?: number;
  complained?: number;
  opened?: number;
  clicked?: number;
  unsubscribed?: number;
  sent?: number;
  received?: number;
  failed?: number;
  delivery_rate?: number;
  bounce_rate?: number;
  complaint_rate?: number;
  open_rate?: number;
  click_rate?: number;
  unsubscribe_rate?: number;
  domain?: string;
  email?: string;
  broadcast?: string;
};

type ResendMetricsResponse = {
  object?: string;
  start_date?: string;
  end_date?: string;
  metrics?: string[];
  dimensions?: string[];
  granularity?: "hourly" | "daily" | "weekly" | "monthly";
  totals?: Record<string, number>;
  data?: ResendMetricsRow[];
};

export type DailyEmailMetricRowFromApi = {
  date: string;
  audienceId?: string;
  kind: "bounce" | "complaint" | "delivery" | "open" | "click";
  count: number;
  source: "api";
  ingestedAt: number;
};

function formatUtcDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function periodToDate(period: string): string | null {
  const match = period.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

export function parseMetricsResponse(
  payload: ResendMetricsResponse,
  ingestedAt: number
): { rows: DailyEmailMetricRowFromApi[]; unparseableRows: number } {
  const rows: DailyEmailMetricRowFromApi[] = [];
  let unparseableRows = 0;
  for (const dataRow of payload.data ?? []) {
    const period = dataRow.period ?? dataRow.date ?? "";
    const date = periodToDate(period);
    if (!date) {
      unparseableRows++;
      continue;
    }

    if (typeof dataRow.delivered === "number") {
      rows.push({ date, kind: "delivery", count: dataRow.delivered, source: "api", ingestedAt });
    }
    if (typeof dataRow.bounced === "number") {
      rows.push({ date, kind: "bounce", count: dataRow.bounced, source: "api", ingestedAt });
    }
    if (typeof dataRow.complained === "number") {
      rows.push({ date, kind: "complaint", count: dataRow.complained, source: "api", ingestedAt });
    }
    if (typeof dataRow.opened === "number") {
      rows.push({ date, kind: "open", count: dataRow.opened, source: "api", ingestedAt });
    }
    if (typeof dataRow.clicked === "number") {
      rows.push({ date, kind: "click", count: dataRow.clicked, source: "api", ingestedAt });
    }
  }
  return { rows, unparseableRows };
}

export const fetchAndStore = internalAction({
  args: {
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    windowStart: string;
    windowEnd: string;
    fetchedDays: number;
    unparseableRows: number;
    inserted: number;
    updated: number;
    unchanged: number;
    attempts: number;
  }> => {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error("RESEND_API_KEY is not set (required for daily metrics ingestion)");
    }

    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 3600_000);
    const startDate = args.startDate ?? formatUtcDate(yesterday);
    const endDate = args.endDate ?? formatUtcDate(now);

    const url = new URL(RESEND_METRICS_URL);
    url.searchParams.set("start_date", startDate);
    url.searchParams.set("end_date", endDate);
    url.searchParams.set("granularity", "daily");
    url.searchParams.append("metrics", "delivered");
    url.searchParams.append("metrics", "bounced");
    url.searchParams.append("metrics", "complained");
    url.searchParams.append("metrics", "opened");
    url.searchParams.append("metrics", "clicked");
    url.searchParams.append("dimensions", "period");

    let response: Response | null = null;
    let attempts = 0;
    let lastError: Error | null = null;
    for (attempts = 0; attempts < MAX_ATTEMPTS; attempts++) {
      try {
        response = await fetch(url.toString(), {
          method: "GET",
          headers: { Authorization: `Bearer ${apiKey}` },
        });
      } catch (networkError) {
        const backoffMs = Math.min(
          MAX_BACKOFF_MS,
          BASE_BACKOFF_MS * Math.pow(2, attempts)
        );
        lastError = new Error(
          `Resend metrics network error on attempt ${attempts + 1}: ${networkError instanceof Error ? networkError.message : String(networkError)}`
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }
      if (isRetryableStatus(response.status)) {
        const backoffMs = Math.min(
          MAX_BACKOFF_MS,
          BASE_BACKOFF_MS * Math.pow(2, attempts)
        );
        lastError = new Error(`Resend metrics retryable status ${response.status} on attempt ${attempts + 1}`);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }
      lastError = null;
      break;
    }
    if (lastError !== null) {
      throw lastError;
    }
    if (!response || !response.ok) {
      const status = response?.status ?? 0;
      const body = response ? await response.text() : "";
      throw new Error(`Resend metrics fetch failed: ${status} ${body}`);
    }

    const payload = (await response.json()) as ResendMetricsResponse;
    const ingestedAt = Date.now();
    const { rows, unparseableRows } = parseMetricsResponse(payload, ingestedAt);

    if (rows.length === 0 && unparseableRows > 0) {
      throw new Error(
        `Resend metrics response had ${unparseableRows} unparseable rows (no valid periods); treating as failed ingestion run`
      );
    }

    if (rows.length === 0) {
      return {
        windowStart: startDate,
        windowEnd: endDate,
        fetchedDays: payload.data?.length ?? 0,
        unparseableRows,
        inserted: 0,
        updated: 0,
        unchanged: 0,
        attempts: attempts + 1,
      };
    }

    const result = await ctx.runMutation(internal.mutations.dailyEmailMetrics.upsertDailyMetrics, {
      rows,
    });

    return {
      windowStart: startDate,
      windowEnd: endDate,
      fetchedDays: payload.data?.length ?? 0,
      unparseableRows,
      inserted: result.inserted,
      updated: result.updated,
      unchanged: result.unchanged,
      attempts: attempts + 1,
    };
  },
});
