"use client";

import { Loader2, X, CheckCircle2, AlertCircle } from "lucide-react";
import type { BulkDownloadStatus } from "@/lib/api";

interface BulkDownloadProgressProps {
  status: BulkDownloadStatus | null;
  error: string | null;
  isSubmitting: boolean;
  onDismiss: () => void;
}

function formatMessage(
  status: BulkDownloadStatus | null,
  isSubmitting: boolean,
  fileCount: number
): string {
  if (isSubmitting && !status) return "Preparing ZIP…";
  if (!status) return "Preparing ZIP…";
  if (status.status === "pending") return "Preparing ZIP…";
  if (status.status === "processing") {
    return `Bundling ${fileCount || status.fileCount} file${(fileCount || status.fileCount) === 1 ? "" : "s"}…`;
  }
  if (status.status === "completed") return "ZIP ready — downloading…";
  return "";
}

export function BulkDownloadProgress({
  status,
  error,
  isSubmitting,
  onDismiss,
}: BulkDownloadProgressProps): React.ReactElement | null {
  const showProgress =
    isSubmitting || (status !== null && status.status !== "completed");

  if (error && !showProgress) {
    return (
      <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-red-700/50 bg-red-900/20 px-4 py-2 text-sm">
        <div className="flex items-center gap-2 text-red-300">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
        <button
          onClick={onDismiss}
          className="text-red-300 hover:text-white"
          aria-label="Dismiss error"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  if (!showProgress) return null;

  const isCompleted = status?.status === "completed";
  const isFailed = status?.status === "failed";
  const message = isFailed
    ? (error ?? "Download failed")
    : formatMessage(status, isSubmitting, 0);

  const Icon = isCompleted ? CheckCircle2 : isFailed ? AlertCircle : Loader2;
  const colorClass = isCompleted
    ? "text-emerald-300 border-emerald-700/50 bg-emerald-900/20"
    : isFailed
      ? "text-red-300 border-red-700/50 bg-red-900/20"
      : "text-slate-300 border-slate-700 bg-slate-800/40";

  return (
    <div
      className={`mb-3 flex items-center justify-between gap-3 rounded-lg border px-4 py-2 text-sm ${colorClass}`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <Icon
          className={`w-4 h-4 flex-shrink-0 ${!isCompleted && !isFailed ? "animate-spin" : ""}`}
        />
        <span>{message}</span>
      </div>
      {(isCompleted || isFailed) && (
        <button
          onClick={onDismiss}
          className="text-slate-400 hover:text-white"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
