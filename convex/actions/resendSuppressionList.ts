"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";

const RESEND_SUPPRESSIONS_URL = "https://api.resend.com/suppressions";
const PAGE_LIMIT = 100;

type ResendSuppressionListEntry = {
  id: string;
  email: string;
  origin: "bounce" | "complaint" | "manual";
  source_id: string | null;
  created_at: string;
};

type ResendSuppressionListResponse = {
  object?: string;
  has_more: boolean;
  data: ResendSuppressionListEntry[];
};

function originToKind(origin: "bounce" | "complaint" | "manual"): "bounce" | "complaint" | "unsubscribe" {
  if (origin === "manual") return "unsubscribe";
  return origin;
}

function domainFromEmail(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).toLowerCase();
}

function parseCreatedAtToEpoch(createdAt: string, fallback: number): number {
  const ms = Date.parse(createdAt);
  return Number.isFinite(ms) ? ms : fallback;
}

export const seedSuppressionEventsFromList = internalAction({
  args: {
    after: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error("RESEND_API_KEY is not set (required for Suppression List backfill)");
    }

    const url = new URL(RESEND_SUPPRESSIONS_URL);
    url.searchParams.set("limit", String(PAGE_LIMIT));
    if (args.after) {
      url.searchParams.set("after", args.after);
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Resend Suppression List fetch failed: ${response.status} ${body}`);
    }

    const payload = (await response.json()) as ResendSuppressionListResponse;
    const receivedAt = Date.now();

    let inserted = 0;
    let skipped = 0;
    for (const entry of payload.data) {
      const kind = originToKind(entry.origin);
      const occurredAt = parseCreatedAtToEpoch(entry.created_at, receivedAt);
      const result = await ctx.runMutation(internal.suppressionEvents.upsertSuppressionEvent, {
        kind,
        email: entry.email,
        domain: domainFromEmail(entry.email),
        resendId: `list:${entry.id}`,
        reason: entry.origin,
        receivedAt,
        occurredAt,
        audienceId: entry.source_id ?? undefined,
        raw: entry,
      });
      if (result.created) inserted++;
      else skipped++;
    }

    if (payload.has_more && payload.data.length > 0) {
      const lastId = payload.data[payload.data.length - 1].id;
      await ctx.scheduler.runAfter(0, internal.resendSuppressionList.seedSuppressionEventsFromList, {
        after: lastId,
      });
    }

    return {
      fetched: payload.data.length,
      inserted,
      skipped,
      hasMore: payload.has_more,
      after: payload.data.length > 0 ? payload.data[payload.data.length - 1].id : args.after ?? null,
    };
  },
});
