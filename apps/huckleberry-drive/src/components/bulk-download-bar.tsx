"use client";

import type { ReactElement } from "react";
import { Download, X, Loader2 } from "lucide-react";
import { BULK_DOWNLOAD_MAX_FILES } from "@/lib/api";
import type { BulkDownloadStatus } from "@/lib/api";

interface BulkDownloadBarProps {
  selectedIds: Set<string>;
  status: BulkDownloadStatus | null;
  isSubmitting: boolean;
  isInFlight: boolean;
  onSubmit: () => void;
  onClearSelection: () => void;
}

export function BulkDownloadBar({
  selectedIds,
  status,
  isSubmitting,
  isInFlight,
  onSubmit,
  onClearSelection,
}: BulkDownloadBarProps): ReactElement | null {
  if (selectedIds.size === 0 && !status) return null;

  const count = selectedIds.size;
  const isOverLimit = count > BULK_DOWNLOAD_MAX_FILES;
  const isCompleted = status?.status === "completed";
  const showCompletedLabel = isCompleted && count === 0;

  let buttonLabel: string;
  let disabled = false;
  let title: string | undefined;

  if (isSubmitting || isInFlight) {
    buttonLabel = "Preparing ZIP…";
    disabled = true;
    title = "A download is already in progress";
  } else if (isOverLimit) {
    buttonLabel = `Download ${count} as ZIP`;
    disabled = true;
    title = `Maximum ${BULK_DOWNLOAD_MAX_FILES} files per ZIP`;
  } else if (showCompletedLabel) {
    buttonLabel = "Downloaded";
    disabled = true;
  } else if (count === 0) {
    return null;
  } else {
    buttonLabel = `Download ${count} as ZIP`;
  }

  return (
    <div
      className="sticky bottom-3 z-30 mt-3 flex items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-800/90 px-4 py-3 shadow-lg backdrop-blur"
      role="region"
      aria-label="Bulk download"
    >
      <div className="flex items-center gap-3 text-sm text-slate-200">
        {showCompletedLabel ? (
          <>
            <Download className="w-4 h-4 text-emerald-400" />
            <span>ZIP downloaded</span>
          </>
        ) : (
          <>
            <Download className="w-4 h-4 text-emerald-400" />
            <span>
              {count} file{count === 1 ? "" : "s"} selected
              {isOverLimit && (
                <span className="ml-2 text-amber-400">
                  (max {BULK_DOWNLOAD_MAX_FILES})
                </span>
              )}
            </span>
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onSubmit}
          disabled={disabled}
          title={title}
          className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {(isSubmitting || isInFlight) && (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          )}
          {buttonLabel}
        </button>
        {!showCompletedLabel && (
          <button
            onClick={onClearSelection}
            className="inline-flex items-center gap-1 rounded-md bg-slate-700 px-3 py-1.5 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-600"
            aria-label="Clear selection"
          >
            <X className="w-3.5 h-3.5" />
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
