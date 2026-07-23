"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getBulkDownloadStatus,
  requestBulkDownload,
  BULK_DOWNLOAD_MAX_FILES,
} from "@/lib/api";
import type { BulkDownloadStatus } from "@/lib/api";

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;
const COMPLETED_DISMISS_MS = 60 * 1000;

export interface UseBulkDownloadResult {
  isSubmitting: boolean;
  jobId: string | null;
  status: BulkDownloadStatus | null;
  error: string | null;
  isInFlight: boolean;
  submit: (fileIds: string[]) => void;
  reset: () => void;
}

export function useBulkDownload(): UseBulkDownloadResult {
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<BulkDownloadStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollStartRef = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    clearTimers();
    setJobId(null);
    setStatus(null);
    setError(null);
    setIsSubmitting(false);
    pollStartRef.current = null;
  }, [clearTimers]);

  const submit = useCallback(
    (fileIds: string[]) => {
      if (fileIds.length === 0) return;
      if (fileIds.length > BULK_DOWNLOAD_MAX_FILES) {
        setError(
          `Too many files selected. Maximum is ${BULK_DOWNLOAD_MAX_FILES}.`
        );
        return;
      }

      clearTimers();
      setError(null);
      setStatus(null);
      setIsSubmitting(true);
      pollStartRef.current = Date.now();

      requestBulkDownload(fileIds)
        .then(({ jobId: newJobId }) => {
          setJobId(newJobId);
        })
        .catch((err: unknown) => {
          setError(
            err instanceof Error ? err.message : "Failed to start download"
          );
          setIsSubmitting(false);
          pollStartRef.current = null;
        });
    },
    [clearTimers]
  );

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;

    const poll = async (): Promise<void> => {
      try {
        const next = await getBulkDownloadStatus(jobId);
        if (cancelled) return;
        setStatus(next);
        setIsSubmitting(false);

        if (next.status === "completed") {
          if (next.downloadUrl) {
            window.open(next.downloadUrl, "_blank", "noopener,noreferrer");
          }
          dismissTimerRef.current = setTimeout(() => {
            if (!cancelled) {
              setJobId(null);
              setStatus(null);
              pollStartRef.current = null;
            }
          }, COMPLETED_DISMISS_MS);
          return;
        }

        if (next.status === "failed") {
          setError(next.error ?? "Download failed");
          dismissTimerRef.current = setTimeout(() => {
            if (!cancelled) {
              setJobId(null);
              setStatus(null);
              setError(null);
              pollStartRef.current = null;
            }
          }, COMPLETED_DISMISS_MS);
          return;
        }

        if (
          pollStartRef.current !== null &&
          Date.now() - pollStartRef.current > POLL_TIMEOUT_MS
        ) {
          setError("Still preparing — check back in a moment.");
          dismissTimerRef.current = setTimeout(() => {
            if (!cancelled) reset();
          }, COMPLETED_DISMISS_MS);
          return;
        }

        setTimeout(() => {
          if (!cancelled) void poll();
        }, POLL_INTERVAL_MS);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Status check failed");
        setIsSubmitting(false);
      }
    };

    void poll();

    return () => {
      cancelled = true;
    };
  }, [jobId, reset]);

  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  const isInFlight =
    isSubmitting || (status?.status === "pending" || status?.status === "processing");

  return {
    isSubmitting,
    jobId,
    status,
    error,
    isInFlight,
    submit,
    reset,
  };
}
