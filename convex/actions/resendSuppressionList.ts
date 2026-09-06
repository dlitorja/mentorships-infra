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
      const result = await ctx.runMutation(internal.mutations.suppressionEvents.upsertSuppressionEvent, {
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
      await ctx.scheduler.runAfter(0, internal.actions.resendSuppressionList.seedSuppressionEventsFromList, {
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

export const reconcileSuppressionListPage = internalAction({
  args: {
    after: v.optional(v.string()),
    // Bounded by Convex scheduler arg limit (1 MB). Resend suppression
    // IDs are ~36 chars; this supports ~27k entries. Realistic
    // suppression lists are <5k. If a tenant ever exceeds this, the
    // scheduler will reject the call; mitigation = store activeIds
    // in a temp table keyed by runStartedAt and read in finalize.
    activeIds: v.array(v.string()),
    runStartedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error("RESEND_API_KEY is not set (required for Suppression List reconcile)");
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

    let upserted = 0;
    let alreadyPresent = 0;
    const seenIds = [...args.activeIds];
    for (const entry of payload.data) {
      const kind = originToKind(entry.origin);
      const occurredAt = parseCreatedAtToEpoch(entry.created_at, receivedAt);
      const result = await ctx.runMutation(internal.mutations.suppressionEvents.upsertSuppressionEvent, {
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
      if (result.created) upserted++;
      else alreadyPresent++;
      seenIds.push(entry.id);
    }

    if (payload.has_more && payload.data.length > 0) {
      const lastId = payload.data[payload.data.length - 1].id;
      await ctx.scheduler.runAfter(0, internal.actions.resendSuppressionList.reconcileSuppressionListPage, {
        after: lastId,
        activeIds: seenIds,
        runStartedAt: args.runStartedAt,
      });
      return {
        fetched: payload.data.length,
        upserted,
        alreadyPresent,
        hasMore: true,
      };
    }

    await ctx.scheduler.runAfter(0, internal.actions.resendSuppressionList.finalizeReconcile, {
      activeIds: seenIds,
      runStartedAt: args.runStartedAt,
    });

    return {
      fetched: payload.data.length,
      upserted,
      alreadyPresent,
      hasMore: false,
    };
  },
});

export const finalizeReconcile = internalAction({
  args: {
    activeIds: v.array(v.string()),
    runStartedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const listRows = await ctx.runQuery(
      internal.queries.suppressionListQueries.getListStateRowsBefore,
      { before: args.runStartedAt - 60_000 }
    );

    const activeSet = new Set(args.activeIds);
    const removedCandidates = new Map<string, { resendId: string; email: string; domain: string }>();
    for (const row of listRows) {
      if (row.kind === "removed") continue;
      const match = row.resendId.match(/^list:(.+)$/);
      if (!match) continue;
      const suppressionId = match[1];
      if (activeSet.has(suppressionId)) continue;
      if (removedCandidates.has(suppressionId)) continue;
      removedCandidates.set(suppressionId, {
        resendId: row.resendId,
        email: row.email,
        domain: row.domain,
      });
    }

    const candidatesArr = Array.from(removedCandidates.values());
    await ctx.scheduler.runAfter(0, internal.actions.resendSuppressionList.finalizeReconcileBatch, {
      batch: candidatesArr,
      markCompleted: true,
    });
    return {
      activeCount: activeSet.size,
      candidates: candidatesArr.length,
    };
  },
});

async function writeRemovalBatch(
  ctx: { runMutation: Function },
  batch: { resendId: string; email: string; domain: string }[]
): Promise<{ upserted: number; alreadyPresent: number }> {
  let upserted = 0;
  let alreadyPresent = 0;
  const receivedAt = Date.now();
  for (const info of batch) {
    const result = await ctx.runMutation(internal.mutations.suppressionEvents.upsertSuppressionEvent, {
      kind: "removed",
      email: info.email,
      domain: info.domain,
      resendId: `removed:${info.resendId.replace(/^list:/, "")}`,
      reason: "Reconcile detected removal",
      receivedAt,
      occurredAt: receivedAt,
      raw: { removedFromActiveSet: true, originalSuppression: info.resendId },
    });
    if (result.created) upserted++;
    else alreadyPresent++;
  }
  return { upserted, alreadyPresent };
}

const FINALIZE_BATCH_SIZE = 100;

export const finalizeReconcileBatch = internalAction({
  args: {
    batch: v.array(
      v.object({
        resendId: v.string(),
        email: v.string(),
        domain: v.string(),
      })
    ),
    markCompleted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    if (args.batch.length === 0) {
      if (args.markCompleted) {
        await ctx.runMutation(internal.mutations.reconcileRunState.markReconcileCompleted, {
          completedAt: Date.now(),
        });
        return { upserted: 0, alreadyPresent: 0, remaining: 0, completed: true };
      }
      return { upserted: 0, alreadyPresent: 0, remaining: 0, completed: false };
    }
    const head = args.batch.slice(0, FINALIZE_BATCH_SIZE);
    const tail = args.batch.slice(FINALIZE_BATCH_SIZE);
    const written = await writeRemovalBatch(ctx, head);
    if (tail.length > 0) {
      await ctx.scheduler.runAfter(0, internal.actions.resendSuppressionList.finalizeReconcileBatch, {
        batch: tail,
        markCompleted: args.markCompleted ?? false,
      });
      return {
        upserted: written.upserted,
        alreadyPresent: written.alreadyPresent,
        remaining: tail.length,
        completed: false,
      };
    }
    if (args.markCompleted) {
      await ctx.runMutation(internal.mutations.reconcileRunState.markReconcileCompleted, {
        completedAt: Date.now(),
      });
    }
    return {
      upserted: written.upserted,
      alreadyPresent: written.alreadyPresent,
      remaining: 0,
      completed: args.markCompleted ?? false,
    };
  },
});

export const runReconcileSuppressionList = internalAction({
  args: {},
  handler: async (ctx): Promise<
    | { scheduled: true; runStartedAt: number }
    | {
        scheduled: false;
        runStartedAt: number;
        reason: string;
        previousStartedAt: number | null;
      }
  > => {
    const runStartedAt = Date.now();
    const lock = await ctx.runMutation(internal.mutations.reconcileRunState.tryStartReconcile, {
      runStartedAt,
    });
    if (!lock.acquired) {
      return {
        scheduled: false,
        runStartedAt,
        reason: lock.reason,
        previousStartedAt: lock.previousStartedAt,
      };
    }
    await ctx.scheduler.runAfter(0, internal.actions.resendSuppressionList.reconcileSuppressionListPage, {
      after: undefined,
      activeIds: [],
      runStartedAt,
    });
    return { scheduled: true, runStartedAt };
  },
});
