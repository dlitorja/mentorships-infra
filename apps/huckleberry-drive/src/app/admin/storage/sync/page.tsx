"use client";

import React, { useState, useEffect, useCallback } from "react";
import { RefreshCw, Trash2, AlertTriangle, CheckCircle2, Loader2, HardDrive, Cloud } from "lucide-react";

interface ExpiredDeletion {
  id: string;
  filename: string | undefined;
  s3Key: string | undefined;
  originalName: string;
  deletedAt: number;
  daysExpired: number;
  instructorId: string;
  size: number;
}

interface OrphanedFile {
  key: string;
  size: number;
  lastModified: string;
}

interface SyncStatus {
  expiredDeletions: ExpiredDeletion[];
  orphanedInB2: OrphanedFile[];
  summary: {
    expiredCount: number;
    orphanedCount: number;
    totalOrphanedSize: number;
    totalB2Objects: number;
  };
}

interface CleanupResult {
  success: boolean;
  cleanupId: string;
  totalToCleanup: number;
  cleanedUp: number;
  failed: number;
  status: string;
  errors?: string[];
}

export default function StorageSyncPage(): React.ReactElement {
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCleaningUp, setIsCleaningUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCleanup, setLastCleanup] = useState<CleanupResult | null>(null);

  const fetchSyncStatus = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await fetch("/api/storage/sync-status");
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
      const data = await response.json();
      setSyncStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch sync status");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSyncStatus();
  }, [fetchSyncStatus]);

  const handleCleanup = useCallback(async () => {
    if (!confirm("This will permanently delete all expired files. Continue?")) {
      return;
    }

    try {
      setIsCleaningUp(true);
      setError(null);
      const response = await fetch("/api/storage/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
      const result: CleanupResult = await response.json();
      setLastCleanup(result);

      if (result.success) {
        await fetchSyncStatus();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cleanup failed");
    } finally {
      setIsCleaningUp(false);
    }
  }, [fetchSyncStatus]);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const formatDateTime = (dateStr: string): string => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-100">Storage Sync</h1>
          <p className="text-slate-400 mt-1">
            Monitor and sync bucket contents with database records
          </p>
        </div>
        <button
          onClick={fetchSyncStatus}
          disabled={isLoading}
          className="flex items-center gap-2 px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white transition-colors disabled:opacity-50"
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" />
          <span className="text-red-400">{error}</span>
        </div>
      )}

      {lastCleanup && (
        <div className={`bg-slate-800/30 border rounded-lg p-4 flex items-center gap-3 ${
          lastCleanup.status === "completed" 
            ? "border-emerald-500/30" 
            : lastCleanup.status === "partial"
            ? "border-amber-500/30"
            : "border-red-500/30"
        }`}>
          {lastCleanup.status === "completed" ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
          ) : lastCleanup.status === "partial" ? (
            <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" />
          )}
          <div>
            <span className="text-slate-200">
              Cleanup {lastCleanup.status}: {lastCleanup.cleanedUp} of {lastCleanup.totalToCleanup} files processed
            </span>
            {lastCleanup.failed > 0 && (
              <span className="text-amber-400 ml-2">({lastCleanup.failed} failed)</span>
            )}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <Loader2 className="w-12 h-12 border-b-2 border-emerald-500 mx-auto animate-spin" />
            <p className="mt-4 text-slate-400">Loading storage sync status...</p>
          </div>
        </div>
      ) : syncStatus ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-amber-500/10 rounded-lg">
                  <Trash2 className="w-5 h-5 text-amber-400" />
                </div>
                <span className="text-slate-400 text-sm">Expired Deletions</span>
              </div>
              <p className="text-3xl font-bold text-slate-100">{syncStatus.summary.expiredCount}</p>
              <p className="text-sm text-slate-500 mt-1">Files past 60-day grace period</p>
            </div>

            <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-red-500/10 rounded-lg">
                  <Cloud className="w-5 h-5 text-red-400" />
                </div>
                <span className="text-slate-400 text-sm">Orphaned in B2</span>
              </div>
              <p className="text-3xl font-bold text-slate-100">{syncStatus.summary.orphanedCount}</p>
              <p className="text-sm text-slate-500 mt-1">
                {formatBytes(syncStatus.summary.totalOrphanedSize)} not in database
              </p>
            </div>

            <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-emerald-500/10 rounded-lg">
                  <HardDrive className="w-5 h-5 text-emerald-400" />
                </div>
                <span className="text-slate-400 text-sm">Total B2 Objects</span>
              </div>
              <p className="text-3xl font-bold text-slate-100">{syncStatus.summary.totalB2Objects}</p>
              <p className="text-sm text-slate-500 mt-1">Across all buckets</p>
            </div>
          </div>

          {syncStatus.summary.expiredCount > 0 && (
            <div className="bg-slate-800/30 border border-slate-700 rounded-xl overflow-hidden">
              <div className="p-4 border-b border-slate-700 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-200">
                  Expired Deletions ({syncStatus.summary.expiredCount})
                </h2>
                <button
                  onClick={handleCleanup}
                  disabled={isCleaningUp}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {isCleaningUp ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Cleaning up...
                    </span>
                  ) : (
                    "Cleanup All Expired"
                  )}
                </button>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-700 bg-slate-800/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      File
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      Deleted
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      Days Expired
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      Size
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {syncStatus.expiredDeletions.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="px-4 py-3">
                        <span className="font-medium text-slate-200 truncate max-w-xs block">
                          {item.originalName}
                        </span>
                        {item.filename && (
                          <span className="text-xs text-slate-500 truncate max-w-xs block">
                            {item.filename}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-400">
                        {formatDate(item.deletedAt)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-amber-400 font-medium">{item.daysExpired} days</span>
                      </td>
                      <td className="px-4 py-3 text-slate-400">
                        {formatBytes(item.size)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {syncStatus.summary.orphanedCount > 0 && (
            <div className="bg-slate-800/30 border border-slate-700 rounded-xl overflow-hidden">
              <div className="p-4 border-b border-slate-700">
                <h2 className="text-lg font-semibold text-slate-200">
                  Orphaned in B2 ({syncStatus.summary.orphanedCount})
                </h2>
                <p className="text-sm text-slate-500 mt-1">
                  These files exist in B2 but have no corresponding database record
                </p>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-700 bg-slate-800/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      Key
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      Last Modified
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      Size
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {syncStatus.orphanedInB2.map((item) => (
                    <tr key={item.key} className="hover:bg-slate-800/30 transition-colors">
                      <td className="px-4 py-3">
                        <span className="font-medium text-slate-200 truncate max-w-xs block">
                          {item.key.split("/").pop()}
                        </span>
                        <span className="text-xs text-slate-500 truncate max-w-xs block">
                          {item.key}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400">
                        {formatDateTime(item.lastModified)}
                      </td>
                      <td className="px-4 py-3 text-slate-400">
                        {formatBytes(item.size)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {syncStatus.summary.expiredCount === 0 && syncStatus.summary.orphanedCount === 0 && (
            <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-12 text-center">
              <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-slate-200 mb-2">Storage is in sync</h2>
              <p className="text-slate-400">
                No expired deletions or orphaned files detected
              </p>
            </div>
          )}
        </>
      ) : (
        <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-12 text-center">
          <AlertTriangle className="w-12 h-12 text-amber-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-slate-200 mb-2">Unable to load sync status</h2>
          <p className="text-slate-400">Please try refreshing the page</p>
        </div>
      )}
    </div>
  );
}