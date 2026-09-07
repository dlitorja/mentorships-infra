/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { parseMetricsResponse } from "./actions/resendMetrics";

const modules = import.meta.glob("./**/*.ts");

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function emptyResponse(status = 200): Response {
  return new Response("", { status });
}

beforeEach(() => {
  process.env.RESEND_API_KEY = "re_test_key_for_convex_test";
  globalThis.fetch = vi.fn() as unknown as typeof fetch;
});

afterEach(() => {
  delete process.env.RESEND_API_KEY;
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

test("parseMetricsResponse: maps Resend API response to dailyEmailMetrics row shape", () => {
  const ingestedAt = 1_700_000_000_000;
  const payload = {
    object: "metrics",
    start_date: "2026-09-05T00:00:00.000Z",
    end_date: "2026-09-06T00:00:00.000Z",
    granularity: "daily",
    dimensions: ["period"],
    metrics: ["delivered", "bounced", "complained", "opened", "clicked"],
    totals: {
      delivered: 250,
      bounced: 12,
      complained: 0,
      opened: 100,
      clicked: 25,
    },
    data: [
      {
        period: "2026-09-05",
        delivered: 125,
        bounced: 6,
        complained: 0,
        opened: 50,
        clicked: 12,
      },
      {
        period: "2026-09-06",
        delivered: 125,
        bounced: 6,
        complained: 0,
        opened: 50,
        clicked: 13,
      },
    ],
  };

  const rows = parseMetricsResponse(payload, ingestedAt);
  expect(rows).toHaveLength(10);
  expect(rows.filter((r) => r.date === "2026-09-05" && r.kind === "delivery")[0]?.count).toBe(125);
  expect(rows.filter((r) => r.date === "2026-09-05" && r.kind === "bounce")[0]?.count).toBe(6);
  expect(rows.filter((r) => r.date === "2026-09-05" && r.kind === "complaint")[0]?.count).toBe(0);
  expect(rows.filter((r) => r.date === "2026-09-05" && r.kind === "open")[0]?.count).toBe(50);
  expect(rows.filter((r) => r.date === "2026-09-05" && r.kind === "click")[0]?.count).toBe(12);
  expect(rows.filter((r) => r.date === "2026-09-06" && r.kind === "click")[0]?.count).toBe(13);
  for (const r of rows) {
    expect(r.source).toBe("api");
    expect(r.ingestedAt).toBe(ingestedAt);
    expect(r.audienceId).toBeUndefined();
  }
});

test("parseMetricsResponse: ignores rows whose period is not YYYY-MM-DD", () => {
  const ingestedAt = 1_700_000_000_000;
  const payload = {
    data: [
      { period: "garbage", delivered: 100 },
      { date: "2026-09-05", delivered: 50 },
    ],
  };
  const rows = parseMetricsResponse(payload, ingestedAt);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.date).toBe("2026-09-05");
  expect(rows[0]?.count).toBe(50);
});

test("parseMetricsResponse: skips metrics that are not present in the row", () => {
  const ingestedAt = 1_700_000_000_000;
  const payload = {
    data: [{ period: "2026-09-05", delivered: 200 }],
  };
  const rows = parseMetricsResponse(payload, ingestedAt);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.kind).toBe("delivery");
  expect(rows[0]?.count).toBe(200);
});

test("parseMetricsResponse: empty data array yields no rows", () => {
  expect(parseMetricsResponse({}, 1_700_000_000_000)).toEqual([]);
  expect(parseMetricsResponse({ data: [] }, 1_700_000_000_000)).toEqual([]);
});

test("upsertDailyMetrics: first write inserts, replay is idempotent (same count, no patch)", async () => {
  const t = convexTest(schema, modules);

  const first = await t.run(async (ctx) => {
    return await ctx.runMutation(internal.mutations.dailyEmailMetrics.upsertDailyMetrics, {
      rows: [
        {
          date: "2026-09-05",
          audienceId: undefined,
          kind: "delivery",
          count: 100,
          source: "api",
          ingestedAt: 1_700_000_000_000,
        },
      ],
    });
  });
  expect(first.inserted).toBe(1);
  expect(first.updated).toBe(0);
  expect(first.unchanged).toBe(0);

  const replay = await t.run(async (ctx) => {
    return await ctx.runMutation(internal.mutations.dailyEmailMetrics.upsertDailyMetrics, {
      rows: [
        {
          date: "2026-09-05",
          audienceId: undefined,
          kind: "delivery",
          count: 100,
          source: "api",
          ingestedAt: 1_700_000_000_000,
        },
      ],
    });
  });
  expect(replay.inserted).toBe(0);
  expect(replay.updated).toBe(0);
  expect(replay.unchanged).toBe(1);

  const rows = await t.run(async (ctx) => {
    return await ctx.db.query("dailyEmailMetrics").collect();
  });
  expect(rows).toHaveLength(1);
});

test("upsertDailyMetrics: same (date, audienceId, kind) with different count patches in place", async () => {
  const t = convexTest(schema, modules);

  await t.run(async (ctx) => {
    return await ctx.runMutation(internal.mutations.dailyEmailMetrics.upsertDailyMetrics, {
      rows: [
        {
          date: "2026-09-05",
          audienceId: undefined,
          kind: "bounce",
          count: 5,
          source: "api",
          ingestedAt: 1_700_000_000_000,
        },
      ],
    });
  });

  const refined = await t.run(async (ctx) => {
    return await ctx.runMutation(internal.mutations.dailyEmailMetrics.upsertDailyMetrics, {
      rows: [
        {
          date: "2026-09-05",
          audienceId: undefined,
          kind: "bounce",
          count: 12,
          source: "api",
          ingestedAt: 1_700_000_001_000,
        },
      ],
    });
  });
  expect(refined.inserted).toBe(0);
  expect(refined.updated).toBe(1);
  expect(refined.unchanged).toBe(0);

  const rows = await t.run(async (ctx) => {
    return await ctx.db.query("dailyEmailMetrics").collect();
  });
  expect(rows).toHaveLength(1);
  expect(rows[0]?.count).toBe(12);
  expect(rows[0]?.ingestedAt).toBe(1_700_000_001_000);
});

test("upsertDailyMetrics: distinct (date, audienceId, kind) keys all coexist", async () => {
  const t = convexTest(schema, modules);

  await t.run(async (ctx) => {
    return await ctx.runMutation(internal.mutations.dailyEmailMetrics.upsertDailyMetrics, {
      rows: [
        {
          date: "2026-09-05",
          audienceId: undefined,
          kind: "delivery",
          count: 100,
          source: "api",
          ingestedAt: 1_700_000_000_000,
        },
        {
          date: "2026-09-05",
          audienceId: "aud_1",
          kind: "delivery",
          count: 50,
          source: "api",
          ingestedAt: 1_700_000_000_000,
        },
        {
          date: "2026-09-06",
          audienceId: undefined,
          kind: "delivery",
          count: 75,
          source: "api",
          ingestedAt: 1_700_000_000_000,
        },
        {
          date: "2026-09-05",
          audienceId: undefined,
          kind: "bounce",
          count: 5,
          source: "api",
          ingestedAt: 1_700_000_000_000,
        },
      ],
    });
  });

  const rows = await t.run(async (ctx) => {
    return await ctx.db.query("dailyEmailMetrics").collect();
  });
  expect(rows).toHaveLength(4);
  const keys = rows.map((r) => `${r.date}|${r.audienceId ?? "_"}|${r.kind}`).sort();
  expect(keys).toEqual([
    "2026-09-05|_|bounce",
    "2026-09-05|_|delivery",
    "2026-09-05|aud_1|delivery",
    "2026-09-06|_|delivery",
  ]);
});

test("upsertDailyMetrics: indexed lookup uses by_date_and_audienceId_and_kind", async () => {
  const t = convexTest(schema, modules);

  await t.run(async (ctx) => {
    await ctx.runMutation(internal.mutations.dailyEmailMetrics.upsertDailyMetrics, {
      rows: [
        {
          date: "2026-09-05",
          audienceId: "aud_1",
          kind: "complaint",
          count: 3,
          source: "api",
          ingestedAt: 1_700_000_000_000,
        },
      ],
    });
  });

  const found = await t.run(async (ctx) => {
    return await ctx.db
      .query("dailyEmailMetrics")
      .withIndex("by_date_and_audienceId_and_kind", (q) =>
        q.eq("date", "2026-09-05").eq("audienceId", "aud_1").eq("kind", "complaint")
      )
      .first();
  });
  expect(found?.count).toBe(3);

  const notFound = await t.run(async (ctx) => {
    return await ctx.db
      .query("dailyEmailMetrics")
      .withIndex("by_date_and_audienceId_and_kind", (q) =>
        q.eq("date", "2026-09-05").eq("audienceId", "aud_1").eq("kind", "bounce")
      )
      .first();
  });
  expect(notFound).toBeNull();
});

test("fetchAndStore: throws when RESEND_API_KEY is not configured", async () => {
  delete process.env.RESEND_API_KEY;
  const t = convexTest(schema, modules);
  await expect(
    t.action(internal.actions.resendMetrics.fetchAndStore, {})
  ).rejects.toThrow(/RESEND_API_KEY is not set/);
});

test("fetchAndStore: success path upserts parsed rows", async () => {
  const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  fetchMock.mockResolvedValueOnce(
    jsonResponse({
      object: "metrics",
      granularity: "daily",
      dimensions: ["period"],
      metrics: ["delivered", "bounced", "complained", "opened", "clicked"],
      data: [
        {
          period: "2026-09-05",
          delivered: 200,
          bounced: 8,
          complained: 0,
          opened: 75,
          clicked: 18,
        },
      ],
    })
  );

  const t = convexTest(schema, modules);
  const result = await t.action(internal.actions.resendMetrics.fetchAndStore, {
    startDate: "2026-09-05",
    endDate: "2026-09-06",
  });

  expect(result.windowStart).toBe("2026-09-05");
  expect(result.windowEnd).toBe("2026-09-06");
  expect(result.fetchedDays).toBe(1);
  expect(result.inserted).toBe(5);
  expect(result.updated).toBe(0);
  expect(result.unchanged).toBe(0);
  expect(result.attempts).toBe(1);

  const rows = await t.run(async (ctx) => {
    return await ctx.db.query("dailyEmailMetrics").collect();
  });
  expect(rows).toHaveLength(5);
  const byKind = Object.fromEntries(rows.map((r) => [r.kind, r.count]));
  expect(byKind.delivery).toBe(200);
  expect(byKind.bounce).toBe(8);
  expect(byKind.complaint).toBe(0);
  expect(byKind.open).toBe(75);
  expect(byKind.click).toBe(18);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("fetchAndStore: 429 on first attempt then 200 on second writes rows and records attempts=2", async () => {
  const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  fetchMock
    .mockResolvedValueOnce(emptyResponse(429))
    .mockResolvedValueOnce(
      jsonResponse({
        data: [{ period: "2026-09-05", delivered: 50 }],
      })
    );

  const t = convexTest(schema, modules);
  const result = await t.action(internal.actions.resendMetrics.fetchAndStore, {
    startDate: "2026-09-05",
    endDate: "2026-09-06",
  });

  expect(result.attempts).toBe(2);
  expect(result.inserted).toBe(1);
  expect(fetchMock).toHaveBeenCalledTimes(2);

  const rows = await t.run(async (ctx) => {
    return await ctx.db.query("dailyEmailMetrics").collect();
  });
  expect(rows).toHaveLength(1);
  expect(rows[0]?.kind).toBe("delivery");
  expect(rows[0]?.count).toBe(50);
});

test("fetchAndStore: empty response upserts zero rows and does not throw", async () => {
  const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }));

  const t = convexTest(schema, modules);
  const result = await t.action(internal.actions.resendMetrics.fetchAndStore, {
    startDate: "2026-09-05",
    endDate: "2026-09-06",
  });

  expect(result.fetchedDays).toBe(0);
  expect(result.inserted).toBe(0);
  expect(result.updated).toBe(0);
  expect(result.unchanged).toBe(0);

  const rows = await t.run(async (ctx) => {
    return await ctx.db.query("dailyEmailMetrics").collect();
  });
  expect(rows).toHaveLength(0);
});

test("fetchAndStore: multi-day response upserts all parsed rows", async () => {
  const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  fetchMock.mockResolvedValueOnce(
    jsonResponse({
      data: [
        { period: "2026-09-04", delivered: 100, bounced: 2 },
        { period: "2026-09-05", delivered: 200, bounced: 8 },
        { period: "2026-09-06", delivered: 300, bounced: 4 },
      ],
    })
  );

  const t = convexTest(schema, modules);
  const result = await t.action(internal.actions.resendMetrics.fetchAndStore, {
    startDate: "2026-09-04",
    endDate: "2026-09-07",
  });

  expect(result.fetchedDays).toBe(3);
  expect(result.inserted).toBe(6);

  const rows = await t.run(async (ctx) => {
    return await ctx.db.query("dailyEmailMetrics").collect();
  });
  expect(rows).toHaveLength(6);
  const bounceByDate = Object.fromEntries(
    rows.filter((r) => r.kind === "bounce").map((r) => [r.date, r.count])
  );
  expect(bounceByDate).toEqual({
    "2026-09-04": 2,
    "2026-09-05": 8,
    "2026-09-06": 4,
  });
});

test("fetchAndStore: re-running the same window patches refined counts in place", async () => {
  const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  fetchMock.mockResolvedValueOnce(
    jsonResponse({
      data: [{ period: "2026-09-05", delivered: 100, bounced: 5 }],
    })
  );

  const t = convexTest(schema, modules);
  const first = await t.action(internal.actions.resendMetrics.fetchAndStore, {
    startDate: "2026-09-05",
    endDate: "2026-09-06",
  });
  expect(first.inserted).toBe(2);

  fetchMock.mockResolvedValueOnce(
    jsonResponse({
      data: [{ period: "2026-09-05", delivered: 150, bounced: 7 }],
    })
  );

  const second = await t.action(internal.actions.resendMetrics.fetchAndStore, {
    startDate: "2026-09-05",
    endDate: "2026-09-06",
  });
  expect(second.inserted).toBe(0);
  expect(second.updated).toBe(2);

  const rows = await t.run(async (ctx) => {
    return await ctx.db.query("dailyEmailMetrics").collect();
  });
  expect(rows).toHaveLength(2);
  const delivery = rows.find((r) => r.kind === "delivery");
  const bounce = rows.find((r) => r.kind === "bounce");
  expect(delivery?.count).toBe(150);
  expect(bounce?.count).toBe(7);
});
