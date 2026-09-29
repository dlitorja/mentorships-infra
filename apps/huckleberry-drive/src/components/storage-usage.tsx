"use client";

import React from "react";
import { HardDrive } from "lucide-react";

interface StorageUsageProps {
  usedBytes: number;
  limitBytes: number | null;
  fileCount: number;
  instructorCount?: number;
  hasAccess?: boolean;
  // Counter is a "needs reconciliation" placeholder (lastUpdatedAt
  // === 0). The next cron pass will overwrite with real values.
  isRefreshing?: boolean;
  // Counter hasn't been updated in >24h AND the editor has usage
  // to track. Distinct from `isRefreshing`: a stalled backfill vs
  // a freshly-seeded placeholder.
  isStale?: boolean;
}

export function StorageUsage({
  usedBytes,
  limitBytes,
  fileCount,
  instructorCount,
  hasAccess = true,
  isRefreshing = false,
  isStale = false,
}: StorageUsageProps): React.ReactElement {
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const isUnlimited = limitBytes === null;
  // Round-21 Greptile P2 #1: when the editor has no active assignment,
  // do not render a percentage (would be NaN% or Infinity%). Show a
  // 'No access' state instead.
  const isNoAccess = !hasAccess;

  // HUC-58: surface a "stale" badge when the counter hasn't been
  // updated in 24 h. The staleness is pre-computed server-side (the
  // route handler compares `lastUpdatedAt` against `Date.now()`) so
  // this component stays a pure function of props.

  // Avoid divide-by-zero when limitBytes is 0 but the editor still has
  // SOME access (e.g. revoked-then-restored edge case). Treat 0 limit
  // as exhausted.
  const safePercent = (n: number, total: number): number => {
    if (total <= 0) return 100;
    return (n / total) * 100;
  };

  // Round-33 Greptile P1 #2: when the counter is a placeholder
  // (lastUpdatedAt === 0), the fileCount/bytes shown by the
  // dashboard are delta-math on top of zero — they understate
  // the editor's real usage until the hourly cron reconciles the
  // placeholder. The "refreshing" badge is the right signal, but
  // showing provisional numbers alongside it tells the editor
  // they're trustworthy when they aren't. Hide the numbers and
  // the progress bar; show only the badge plus a "—" row.
  const showProvisionalNumbers = !isRefreshing;

  return (
    <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
      <div className="flex items-center gap-3 mb-4">
        <HardDrive className="w-5 h-5 text-emerald-500" />
        <h3 className="font-semibold text-slate-200">Storage Usage</h3>
        <span className="text-sm text-slate-500 ml-auto">
          {showProvisionalNumbers && (
            <>
              {fileCount} file{fileCount !== 1 ? "s" : ""}{instructorCount !== undefined && ` across ${instructorCount} instructor${instructorCount !== 1 ? "s" : ""}`}
            </>
          )}
          {isRefreshing && (
            <span
              className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-900/40 text-yellow-300 border border-yellow-800"
              title="Storage usage is being reconciled. The hourly backfill will refresh this value shortly."
            >
              refreshing
            </span>
          )}
          {!isRefreshing && isStale && (
            <span
              className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-900/40 text-red-300 border border-red-800"
              title="The storage counter has not been updated in 24 hours. The hourly backfill may have stalled."
            >
              stale
            </span>
          )}
        </span>
      </div>

      <div className="space-y-2">
        {isNoAccess ? (
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">{formatBytes(usedBytes)} used</span>
            <span className="text-slate-500">No active assignments</span>
          </div>
        ) : isRefreshing ? (
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">— used</span>
            <span className="text-slate-500">Reconciling in progress</span>
          </div>
        ) : isUnlimited ? (
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">{formatBytes(usedBytes)} used</span>
          </div>
        ) : (
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">{formatBytes(usedBytes)} used</span>
            <span className="text-slate-400">{formatBytes(limitBytes!)} total</span>
          </div>
        )}

        <div className="h-3 bg-slate-700 rounded-full overflow-hidden">
          {isNoAccess ? (
            <div className="h-full bg-slate-700 w-full flex items-center justify-center text-xs text-slate-400">
              —
            </div>
          ) : isRefreshing ? (
            <div className="h-full bg-slate-700 w-full flex items-center justify-center text-xs text-slate-400">
              —
            </div>
          ) : isUnlimited ? (
            <div className="h-full bg-slate-600 w-full" />
          ) : (
            <div
              className={`h-full transition-all duration-500 ${
                safePercent(usedBytes, limitBytes!) >= 95
                  ? "bg-red-500"
                  : safePercent(usedBytes, limitBytes!) > 80
                  ? "bg-yellow-500"
                  : "bg-emerald-500"
              }`}
              style={{ width: `${Math.min(safePercent(usedBytes, limitBytes!), 100)}%` }}
            />
          )}
        </div>

        {isNoAccess ? (
          <div className="flex justify-between text-xs text-slate-500">
            <span>No access</span>
            <span>Contact an admin</span>
          </div>
        ) : isRefreshing ? (
          <div className="flex justify-between text-xs text-slate-500">
            <span>Reconciling</span>
            <span>Up to 1 hour</span>
          </div>
        ) : isUnlimited ? (
          <div className="flex justify-between text-xs text-slate-500">
            <span>Storage tracked</span>
            <span>Unlimited</span>
          </div>
        ) : (
          <div className="flex justify-between text-xs text-slate-500">
            <span>0%</span>
            <span
              className={
                safePercent(usedBytes, limitBytes!) >= 95
                  ? "text-red-400 font-medium"
                  : safePercent(usedBytes, limitBytes!) > 80
                  ? "text-yellow-400 font-medium"
                  : ""
              }
            >
              {safePercent(usedBytes, limitBytes!).toFixed(1)}% used
            </span>
            <span>100%</span>
          </div>
        )}
      </div>
    </div>
  );
}