/**
 * On-demand operator migration: drives the
 * `backfillWorkspaceB2Storage` internal action against a chosen
 * Convex deployment. Useful for the PR 2 prod verification
 * sweep + a rollback path if the daily Trigger.dev cron
 * (`workspaceStorageBackfillSweep`) is paused.
 *
 * Usage:
 *   CONVEX_DEPLOYMENT=prod \
 *     CONVEX_HTTP_KEY=<key> \
 *     npx tsx scripts/migrate-workspace-storage.ts [--batch=100] [--dry-run] [--max-pages=10]
 *
 * Flags:
 *   --batch=<n>      rows per page (default 50). Bounded by
 *                    Convex's internal query read budget.
 *   --dry-run        count candidates without PUTting to B2.
 *                    Implemented by running the candidate query
 *                    directly (not the action) and printing the
 *                    count, so no B2 traffic is generated.
 *   --max-pages=<n>  stop after N pages even if candidates remain
 *                    (default 10). Pages in chronological order
 *                    via the `cursor` returned by the candidate
 *                    query.
 *
 * The script reads `CONVEX_URL` or `NEXT_PUBLIC_CONVEX_URL`
 * (in that order) for the deployment URL, then authenticates
 * with `CONVEX_HTTP_KEY`. The action is an internalAction, so
 * the deployment's admin auth is required.
 */

import { ConvexHttpClient } from "convex/browser";
import { internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

type Args = {
  batch: number;
  dryRun: boolean;
  maxPages: number;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { batch: 50, dryRun: false, maxPages: 10 };
  for (const arg of argv) {
    if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg.startsWith("--batch=")) {
      const n = Number(arg.slice("--batch=".length));
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`--batch must be a positive integer; got ${arg}`);
      }
      args.batch = Math.min(Math.floor(n), 200);
    } else if (arg.startsWith("--max-pages=")) {
      const n = Number(arg.slice("--max-pages=".length));
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`--max-pages must be a positive integer; got ${arg}`);
      }
      args.maxPages = Math.min(Math.floor(n), 1000);
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: npx tsx scripts/migrate-workspace-storage.ts [--batch=50] [--dry-run] [--max-pages=10]"
      );
      process.exit(0);
    }
  }
  return args;
}

function getConvex(): ConvexHttpClient {
  const url =
    process.env.CONVEX_URL ||
    process.env.NEXT_PUBLIC_CONVEX_URL ||
    process.env.CONVEX_DEPLOYMENT_URL;
  if (!url) {
    throw new Error(
      "Convex deployment URL not configured (CONVEX_URL, NEXT_PUBLIC_CONVEX_URL, or CONVEX_DEPLOYMENT_URL)"
    );
  }
  const client = new ConvexHttpClient(url);
  const key = process.env.CONVEX_HTTP_KEY;
  if (key) {
    client.setAdminAuth(key);
  } else {
    throw new Error("CONVEX_HTTP_KEY is required");
  }
  return client;
}

async function dryRun(convex: ConvexHttpClient, args: Args): Promise<void> {
  console.log("dry-run: counting candidates without PUTting to B2");
  const graceThreshold = Date.now() - 7 * 24 * 60 * 60 * 1000;
  let total = 0;
  let cursor: string | undefined;
  for (let page = 0; page < args.maxPages; page++) {
    const result: {
      rows: Array<{ _id: Id<"fileUploads"> }>;
      nextCursor: string | null;
    } = await convex.query(
      internal.workspaceStorage.listWorkspaceMigrationCandidates,
      { graceThreshold, cursor, limit: args.batch }
    );
    total += result.rows.length;
    cursor = result.nextCursor ?? undefined;
    console.log(
      `  page ${page + 1}: scanned ${result.rows.length}, nextCursor=${result.nextCursor ?? "null"}`
    );
    if (!result.nextCursor) break;
  }
  console.log(`dry-run complete: ${total} candidates across ${args.maxPages} pages max`);
}

async function migrate(convex: ConvexHttpClient, args: Args): Promise<void> {
  let cursor: string | undefined;
  let totalScanned = 0;
  let totalMigrated = 0;
  let totalAlready = 0;
  let totalOrphan = 0;
  let totalRecent = 0;
  let totalFailed = 0;
  for (let page = 0; page < args.maxPages; page++) {
    const result = await convex.action(
      internal.workspaceStorage.backfillWorkspaceB2Storage,
      {
        pageLimit: args.batch,
        cursor,
      }
    );
    totalScanned += result.scanned;
    totalMigrated += result.migrated;
    totalAlready += result.alreadyMigrated;
    totalOrphan += result.skippedOrphan;
    totalRecent += result.skippedTooRecent;
    totalFailed += result.failed;
    cursor = result.nextCursor ?? undefined;
    console.log(
      `  page ${page + 1}: scanned=${result.scanned} migrated=${result.migrated} already=${result.alreadyMigrated} orphan=${result.skippedOrphan} recent=${result.skippedTooRecent} failed=${result.failed} nextCursor=${result.nextCursor ?? "null"}`
    );
    if (!result.nextCursor) break;
  }
  console.log(`migrate complete:`);
  console.log(`  scanned:        ${totalScanned}`);
  console.log(`  migrated:       ${totalMigrated}`);
  console.log(`  already:        ${totalAlready}`);
  console.log(`  skippedOrphan:  ${totalOrphan}`);
  console.log(`  skippedRecent:  ${totalRecent}`);
  console.log(`  failed:         ${totalFailed}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const convex = getConvex();
  if (args.dryRun) {
    await dryRun(convex, args);
  } else {
    await migrate(convex, args);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
