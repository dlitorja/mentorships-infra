"use client";

import React from "react";
import { HardDrive } from "lucide-react";

interface StorageUsageProps {
  usedBytes: number;
  limitBytes: number | null;
  fileCount: number;
  instructorCount?: number;
}

export function StorageUsage({
  usedBytes,
  limitBytes,
  fileCount,
  instructorCount,
}: StorageUsageProps): React.ReactElement {
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const isUnlimited = limitBytes === null;

  return (
    <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
      <div className="flex items-center gap-3 mb-4">
        <HardDrive className="w-5 h-5 text-emerald-500" />
        <h3 className="font-semibold text-slate-200">Storage Usage</h3>
        <span className="text-sm text-slate-500 ml-auto">
          {fileCount} file{fileCount !== 1 ? "s" : ""}{instructorCount !== undefined && ` across ${instructorCount} instructor${instructorCount !== 1 ? "s" : ""}`}
        </span>
      </div>

      <div className="space-y-2">
        {isUnlimited ? (
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
          {isUnlimited ? (
            <div className="h-full bg-slate-600 w-full" />
          ) : (
            <div
              className={`h-full transition-all duration-500 ${
                (usedBytes / limitBytes!) >= 0.95
                  ? "bg-red-500"
                  : (usedBytes / limitBytes!) > 0.8
                  ? "bg-yellow-500"
                  : "bg-emerald-500"
              }`}
              style={{ width: `${Math.min((usedBytes / limitBytes!) * 100, 100)}%` }}
            />
          )}
        </div>

        {isUnlimited ? (
          <div className="flex justify-between text-xs text-slate-500">
            <span>Storage tracked</span>
            <span>Unlimited</span>
          </div>
        ) : (
          <div className="flex justify-between text-xs text-slate-500">
            <span>0%</span>
            <span
              className={
                (usedBytes / limitBytes!) >= 0.95
                  ? "text-red-400 font-medium"
                  : (usedBytes / limitBytes!) > 0.8
                  ? "text-yellow-400 font-medium"
                  : ""
              }
            >
              {((usedBytes / limitBytes!) * 100).toFixed(1)}% used
            </span>
            <span>100%</span>
          </div>
        )}
      </div>
    </div>
  );
}