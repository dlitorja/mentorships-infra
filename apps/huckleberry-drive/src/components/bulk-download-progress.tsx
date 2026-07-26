"use client";

import type { ReactElement } from "react";
import { Loader2, X, CheckCircle2, AlertCircle, Download } from "lucide-react";
import type { BulkDownloadStatus } from "@/lib/api";

interface BulkDownloadProgressProps {
  status: BulkDownloadStatus | null;
  error: string | null;
  isSubmitting: boolean;
  onDismiss: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function formatMessage(
  status: BulkDownloadStatus | null,
  isSubmitting: boolean
): string {
  if (isSubmitting && !status) return "Preparing ZIP…";
  if (!status) return "Preparing ZIP…";
  if (status.status === "pending") return "Preparing ZIP…";
  if (status.status === "processing") {
    if (status.chunkCount > 1) {
      return `Bundling ZIP parts (${status.completedChunks} of ${status.chunkCount} ready)…`;
    }
    return "Bundling files into ZIP…";
  }
  if (status.status === "completed") {
    if (status.chunkCount > 1) {
      return `${status.chunkCount} ZIP parts ready (${status.fileCount} files, ${status.totalBytes ? formatBytes(status.totalBytes) : "unknown size"})`;
    }
    return "ZIP ready";
  }
  return "";
}

export function BulkDownloadProgress({
  status,
  error,
  isSubmitting,
  onDismiss,
}: BulkDownloadProgressProps): ReactElement | null {
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

  const isCompleted = status?.status === "completed";
  const isFailed = status?.status === "failed";
  const hasDownloadUrl = isCompleted && Boolean(status?.downloadUrl);
  const hasDownloadUrls =
    isCompleted && status?.downloadUrls && status.downloadUrls.length > 0;

  if (!showProgress && !isCompleted && !isFailed) return null;

  const message = isFailed
    ? (error ?? "Download failed")
    : formatMessage(status, isSubmitting);

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
      <div className="flex items-center gap-2 min-w-0">
        <Icon
          className={`w-4 h-4 flex-shrink-0 ${!isCompleted && !isFailed ? "animate-spin" : ""}`}
        />
        <span className="truncate">{message}</span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {hasDownloadUrl && (
          <a
            href={status?.downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-emerald-700"
          >
            <Download className="w-3 h-3" />
            Download ZIP
          </a>
        )}
        {hasDownloadUrls && (
          <div className="flex items-center gap-1">
            {status?.downloadUrls?.map((url, index) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-emerald-700"
              >
                <Download className="w-3 h-3" />
                Part {index + 1}
              </a>
            ))}
          </div>
        )}
        {(isCompleted || isFailed || error) && (
          <button
            onClick={onDismiss}
            className="text-slate-400 hover:text-white"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
