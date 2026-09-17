#!/usr/bin/env node
/**
 * Run the CLI-verifiable portion of a post-merge verification check-in.
 *
 * Used by HUC-10 (24h), HUC-11 (48h), and any future schema-change arc.
 * Pairs with a small operator checklist for items that have no public API
 * (Convex Functions-view error rate, Vercel Speed Insights p95, Sentry).
 *
 * What it automates:
 *   - Convex prod insights over the last 72h (OCC + resource limit issues)
 *   - Convex prod failed-log count, optionally grepped by keyword
 *   - Vercel web + platform prod errors in the merge window + 7-day baseline
 *
 * What it does NOT automate (operator must check dashboards):
 *   - Convex dashboard → Functions view → per-function error rate on `instructors:*`
 *   - Vercel Speed Insights → public `/instructors/<slug>` p95 vs baseline
 *   - Sentry → search for the merge keyword
 *
 * Usage:
 *   node scripts/check-post-merge.mjs --merge 2026-09-09T13:59:35Z --keyword instructorProfiles
 *   node scripts/check-post-merge.mjs --merge 2026-09-09T13:59:35Z --windows 24h --keyword instructorProfiles
 *
 * Flags:
 *   --merge <ISO>           Required. Merge timestamp (e.g. 2026-09-09T13:59:35Z).
 *   --windows <list>        Comma-separated hours post-merge to check (default 24h,48h).
 *   --keyword <text>        Pattern to grep for in error logs (e.g. instructorProfiles).
 *   --help                  Show this help.
 *
 * Caveat: Vercel's CLI error-log retention is short (~1-3 days in practice).
 * For windows older than retention, the bucket count will be 0 even if errors
 * did occur. The script annotates the actual oldest entry fetched so the
 * operator can judge whether the comparison is reliable.
 *
 * Override defaults via env:
 *   CONVEX_DEPLOYMENT_URL   Default: https://fine-bulldog-260.convex.cloud
 *   VERCEL_WEB_URL          Default: https://mentorships.huckleberry.art
 *   VERCEL_PLATFORM_URL     Default: https://dev.mentorships.huckleberry.art
 */

import { spawnSync } from "node:child_process";

const COLOR = process.env.NO_COLOR ? null : {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
};
const c = (color, s) => (COLOR && color ? `${COLOR[color]}${s}${COLOR.reset}` : s);

const DEFAULTS = {
  convexUrl: process.env.CONVEX_DEPLOYMENT_URL || "https://fine-bulldog-260.convex.cloud",
  convexDashboard: "https://dashboard.convex.dev/d/fine-bulldog-260",
  vercelWebUrl: process.env.VERCEL_WEB_URL || "https://mentorships.huckleberry.art",
  vercelPlatformUrl: process.env.VERCEL_PLATFORM_URL || "https://dev.mentorships.huckleberry.art",
  sentryUrl: "https://huckleberry-art-academy.sentry.io",
  vercelLogLimit: 5000,
  convexLogHistoryLimit: 1000,
  convexLogStreamSeconds: 25,
};

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        args.flags[key] = next;
        i++;
      } else {
        args.flags[key] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function help() {
  console.log(`Usage: node scripts/check-post-merge.mjs --merge <ISO> [flags]

Required:
  --merge <ISO>            Merge timestamp (e.g. 2026-09-09T13:59:35Z).

Optional:
  --windows <list>         Comma-separated hours post-merge (default 24h,48h).
  --keyword <text>         Pattern to grep in error logs.
  --help                   Show this help.

Output:
  Prints a markdown-friendly summary table comparing the 7-day pre-merge
  baseline against each requested post-merge window, then a checklist of
  dashboard-only items the operator must check by hand.

Caveat: Vercel error-log retention is short (~1-3 days in practice). For
check-ins older than that, the bucket counts will read 0 regardless of
whether errors occurred.`);
}

function fail(msg, code = 1) {
  console.error(`Error: ${msg}`);
  process.exit(code);
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: opts.timeout ?? 180_000,
    ...opts,
  });
}

function convexInsights() {
  const res = run("npx", ["convex", "insights", "--prod", "--json"], { timeout: 60_000 });
  if (res.status !== 0) {
    return { error: (res.stderr || res.stdout || "convex insights failed").split("\n").find(Boolean) };
  }
  try {
    const data = JSON.parse(res.stdout || "{}");
    return {
      healthy: Array.isArray(data.insights) && data.insights.length === 0,
      insightCount: data.insights?.length ?? null,
      deployment: data.deploymentName,
      dashboardUrl: data.dashboardUrl,
    };
  } catch (e) {
    return { error: `parse failed: ${e.message}` };
  }
}

function fetchVercelLogs(url, sinceRel) {
  const args = [
    "dlx", "vercel@latest", "logs", url,
    "--environment", "production",
    "--since", sinceRel,
    "--limit", String(DEFAULTS.vercelLogLimit),
    "--level", "error",
    "--json",
  ];
  const res = run("pnpm", args, { timeout: 180_000 });
  if (res.status !== 0) {
    return { error: (res.stderr || res.stdout || "vercel logs failed").split("\n").find(Boolean) };
  }
  const entries = [];
  for (const line of (res.stdout || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      // skip malformed lines
    }
  }
  if (entries.length === 0) {
    // Vercel CLI writes progress to stderr; an empty stdout here means no
    // matching logs (or a --limit/--filter combo that excluded everything).
    return { entries, warning: "no JSON entries on stdout — empty result or progress-only output" };
  }
  return { entries };
}

function fetchConvexFailedLogs() {
  const res = run("timeout", [
    String(DEFAULTS.convexLogStreamSeconds),
    "npx", "convex", "logs", "--prod",
    "--history", String(DEFAULTS.convexLogHistoryLimit),
    "--jsonl",
  ], { timeout: DEFAULTS.convexLogStreamSeconds * 1000 + 30_000 });
  // `npx convex logs` keeps streaming after `--history N`; `timeout` returns
  // status 124 when it kills the child. Distinguish that from real failures
  // (auth/deploy/network) where status is non-zero and stderr has content.
  const wasTimedOut = res.status === 124;
  if (res.status !== 0 && res.status !== 124) {
    return { error: (res.stderr || res.stdout || "convex logs failed").split("\n").find(Boolean) };
  }
  const entries = [];
  for (const line of (res.stdout || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj.error !== null && obj.error !== undefined) entries.push(obj);
    } catch {
      // skip
    }
  }
  return { entries, timedOut: wasTimedOut };
}

function bucketByWindow(entries, getTime, windows) {
  const buckets = new Map();
  for (const w of windows) buckets.set(w.label, []);
  for (const e of entries) {
    const t = getTime(e);
    if (t == null) continue;
    for (const w of windows) {
      if (t >= w.startMs && t < w.endMs) buckets.get(w.label).push(e);
    }
  }
  return buckets;
}

function pad(s, w) {
  s = String(s);
  return s.length >= w ? s : s + " ".repeat(w - s.length);
}

function printTable(rows, columns) {
  const widths = columns.map((col) =>
    Math.max(col.label.length, ...rows.map((r) => String(r[col.key] ?? "").length))
  );
  const header = columns.map((col, i) => pad(col.label, widths[i])).join("  ");
  const sep = widths.map((w) => "-".repeat(w)).join("  ");
  console.log(c("cyan", header));
  console.log(c("dim", sep));
  for (const row of rows) {
    const line = columns
      .map((col, i) => {
        const val = String(row[col.key] ?? "");
        const padded = pad(val, widths[i]);
        if (col.color) return col.color(row, padded);
        return padded;
      })
      .join("  ");
    console.log(line);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.flags.help) {
    help();
    return;
  }

  const mergeIso = args.flags.merge;
  if (!mergeIso) fail("--merge <ISO> is required. Use --help for usage.");

  const windowsHours = (args.flags.windows || "24h,48h")
    .split(",")
    .map((w) => w.trim().replace(/h$/, ""))
    .filter(Boolean)
    .map(Number);
  if (windowsHours.some((n) => !Number.isInteger(n) || n <= 0)) {
    fail("--windows must be a comma-separated list of positive integers (hours).");
  }

  const keyword = args.flags.keyword || "";
  const mergeMs = Date.parse(mergeIso);
  if (Number.isNaN(mergeMs)) fail(`--merge '${mergeIso}' is not a valid ISO timestamp.`);

  const nowMs = Date.now();
  const baselineStartMs = mergeMs - 24 * 7 * 3600_000;
  const windows = [
    { label: "7d baseline", startMs: baselineStartMs, endMs: mergeMs },
    ...windowsHours.map((h) => {
      const endMs = mergeMs + h * 3600_000;
      return {
        label: `${h}h post-merge`,
        startMs: mergeMs,
        endMs,
        partial: endMs > nowMs,
      };
    }),
  ];

  const oldestWindowStartMs = Math.min(...windows.map((w) => w.startMs));
  const sinceHoursBack = Math.ceil((nowMs - oldestWindowStartMs) / 3600_000) + 1;
  const sinceRel = `${sinceHoursBack}h`;

  console.log(c("bold", `\nPost-merge verification — merge at ${mergeIso}\n`));

  console.log(c("bold", "Convex"));
  const insights = convexInsights();
  if (insights.error) {
    console.log(c("red", `  insights: ${insights.error}`));
  } else {
    console.log(
      c(insights.healthy ? "green" : "yellow",
        `  insights: ${insights.healthy ? "healthy (0 issues over 72h)" : `${insights.insightCount} issue(s) — see dashboard`}`)
    );
    if (insights.dashboardUrl) console.log(c("dim", `  ${insights.dashboardUrl}`));
  }

  if (keyword) {
    const failed = fetchConvexFailedLogs();
    if (failed.error) {
      console.log(c("red", `  failed logs: ${failed.error} (result unknown — check Convex auth/deploy)`));
    } else {
      const hits = failed.entries.filter((e) =>
        JSON.stringify(e).toLowerCase().includes(keyword.toLowerCase())
      );
      const label = `failed-log mentions of \`${keyword}\` (last ${DEFAULTS.convexLogStreamSeconds}s of stream)`;
      const color = failed.timedOut ? "yellow" : (hits.length === 0 ? "green" : "red");
      console.log(
        c(color,
          `  ${label}: ${hits.length} / ${failed.entries.length} failed entries${failed.timedOut ? " [stream timed out, result partial]" : ""}`)
      );
      for (const s of hits.slice(0, 3)) {
        const id = s.identifier || "unknown";
        console.log(c("dim", `    - ${id} (${s.error?.message ?? "no message"})`));
      }
    }
  }

  console.log(c("bold", `\nVercel (production error logs, --since ${sinceRel})`));
  const vercelTargets = [
    { label: "Vercel web", url: DEFAULTS.vercelWebUrl },
    { label: "Vercel platform", url: DEFAULTS.vercelPlatformUrl },
  ];

  for (const target of vercelTargets) {
    const fetched = fetchVercelLogs(target.url, sinceRel);
    if (fetched.error) {
      console.log(c("red", `\n${target.label}: ${fetched.error}`));
      continue;
    }
    if (fetched.warning) {
      console.log(c("yellow", `\n${target.label}: ${fetched.warning}`));
      continue;
    }
    const errors = fetched.entries.filter((e) => e.level === "error");
    const timestamps = errors.map((e) => e.timestamp).filter((t) => t != null);
    const oldestSeenMs = timestamps.length ? Math.min(...timestamps) : null;
    const newestSeenMs = timestamps.length ? Math.max(...timestamps) : null;
    const oldestWindowStart = oldestWindowStartMs;

    const buckets = bucketByWindow(errors, (e) => e.timestamp, windows);
    const rows = windows.map((w) => {
      const inWindow = buckets.get(w.label) ?? [];
      const keywordHits = keyword
        ? inWindow.filter((e) => JSON.stringify(e).toLowerCase().includes(keyword.toLowerCase()))
        : [];
      const notes = [];
      if (oldestSeenMs !== null && w.startMs < oldestSeenMs) notes.push("*retention");
      if (w.partial) notes.push("partial");
      return {
        window: w.label + (notes.length ? ` (${notes.join(", ")})` : ""),
        total: inWindow.length,
        keyword: keyword ? keywordHits.length : "-",
      };
    });

    console.log(`\n${c("cyan", target.label)} (${target.url})`);
    if (oldestSeenMs !== null) {
      const fmt = (ms) => new Date(ms).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "Z");
      console.log(c("dim", `  oldest entry: ${fmt(oldestSeenMs)}    newest entry: ${fmt(newestSeenMs)}`));
      if (oldestWindowStart < oldestSeenMs) {
        console.log(c("yellow",
          `  * window starts before oldest fetched entry — count is incomplete due to Vercel log retention`));
      }
    } else {
      console.log(c("dim", `  no error entries in --since ${sinceRel}`));
    }
    printTable(rows, [
      { key: "window", label: "window" },
      { key: "total", label: "errors" },
      {
        key: "keyword",
        label: keyword ? `mentions \`${keyword}\`` : "keyword hits",
        color: (r) => {
          const v = r.keyword;
          if (v === "-") return c("dim", v);
          if (v === 0) return c("green", String(v));
          return c("red", String(v));
        },
      },
    ]);
  }

  console.log(c("bold", "\nDashboard-only items (operator must check by hand)\n"));
  const checklist = [
    { item: "Convex Functions view", url: `${DEFAULTS.convexDashboard}?view=functions`,
      what: `Search for \`instructors:*\` functions. Error rate must be ≤ 7-day pre-merge baseline.` },
    { item: "Vercel Speed Insights", url: "https://vercel.com/dashboard",
      what: `Filter to \`/instructors/<slug>\` route. p95 must be ≤ 7-day pre-merge baseline.` },
    { item: "Sentry", url: DEFAULTS.sentryUrl,
      what: keyword
        ? `Search for \`${keyword}\`. Any new issue pattern is a regression.`
        : "Search for the merge keyword. Any new issue pattern is a regression." },
  ];
  for (const c1 of checklist) {
    console.log(`- [ ] ${c("cyan", c1.item)} — ${c1.what}`);
    console.log(`      ${c("dim", c1.url)}`);
  }

  console.log();
}

main().catch((e) => {
  console.error(`Unhandled error: ${e.stack ?? e.message ?? e}`);
  process.exit(2);
});
