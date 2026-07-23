"use client";

import React, { useState, useCallback, useRef } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import {
  Upload,
  X,
  Pause,
  Play,
  AlertCircle,
  Film,
  RefreshCw,
} from "lucide-react";
import { initiateUpload, completeUpload, abortUpload } from "@/lib/api";
import { STORAGE_LIMIT_BYTES } from "@/lib/limits";

const ACCEPTED_VIDEO_TYPES = {
  "video/mp4": [".mp4"],
  "video/quicktime": [".mov"],
  "video/x-msvideo": [".avi"],
  "video/webm": [".webm"],
  "video/x-matroska": [".mkv"],
  "video/mpeg": [".mpeg", ".mpg"],
};

const MAX_FILE_SIZE = STORAGE_LIMIT_BYTES;
const MAX_CONCURRENT_UPLOADS = 2;
// PR1: B2 S3 multipart PUTs always return an ETag header. If the
// server is misconfigured (e.g. behind a proxy stripping it) we must
// fail-fast and surface a clear error instead of fabricating a fake
// ETag that B2 will reject at `completeMultipartUpload`. Retry the
// part up to this many times before declaring the upload failed.
const PART_RETRY_ATTEMPTS = 3;
const PART_RETRY_BASE_DELAY_MS = 500;

interface UploadingFile {
  id: string;
  file: File;
  progress: number;
  status: "pending" | "uploading" | "paused" | "completed" | "error";
  error?: string;
  fileId?: string;
  uploadId?: string;
  parts: Array<{ partNumber: number; etag?: string }>;
  uploadedParts: number;
  partSize?: number;
}

interface UploadZoneProps {
  onUploadComplete?: () => void;
  // PR1 (review): fired once when every file in the most recent drop
  // has settled (success or error). Use this instead of
  // `onUploadComplete` for navigation/toasts so the user doesn't get
  // redirected away while sibling uploads are still in flight. The
  // existing per-file callback is preserved for callers that want
  // per-file telemetry.
  onBatchComplete?: () => void;
  instructorId?: string;
}

export function UploadZone({
  onUploadComplete,
  onBatchComplete,
  instructorId,
}: UploadZoneProps): React.ReactElement {
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const [rejectedFiles, setRejectedFiles] = useState<
    Array<{ file: File; errors: string[] }>
  >([]);
  const activeUploadsRef = useRef(0);
  // PR1 (review): tracks the number of files from the most recent
  // drop that are still being processed. Decremented in `uploadFile`'s
  // finally block; when it reaches zero we know the current batch has
  // fully settled and can safely fire `onBatchComplete`.
  const batchPendingRef = useRef(0);
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());

  const uploadFile = useCallback(
    async (uploadingFile: UploadingFile) => {
      const { file } = uploadingFile;
      let initiatedFileId: string | undefined;
      let initiatedUploadId: string | undefined;

      try {
        const initiateResult = await initiateUpload(
          file.name,
          file.type,
          file.size,
          instructorId
        );

        initiatedFileId = initiateResult.fileId;
        initiatedUploadId = initiateResult.uploadId;

        setUploadingFiles((prev) =>
          prev.map((f) =>
            f.id === uploadingFile.id
              ? { ...f, fileId: initiateResult.fileId, uploadId: initiateResult.uploadId, partSize: initiateResult.partSize }
              : f
          )
        );

        const totalParts = initiateResult.partCount;
        const parts: Array<{ partNumber: number; etag: string }> = [];
        const abortController = new AbortController();
        abortControllersRef.current.set(uploadingFile.id, abortController);

        const uploadPart = async (partNumber: number, chunk: Blob): Promise<string> => {
          const presignedUrl = initiateResult.presignedUrls[partNumber - 1];
          if (!presignedUrl) {
            throw new Error(`Missing presigned URL for part ${partNumber}`);
          }

          for (let attempt = 1; attempt <= PART_RETRY_ATTEMPTS; attempt++) {
            if (abortController.signal.aborted) {
              throw new Error("Upload cancelled");
            }

            // PR1 (review): a fetch() rejection (DNS failure, offline,
            // TLS reset, etc.) used to escape the loop on the first
            // transient network blip. Catch non-abort rejections here
            // and retry with the same backoff used for 5xx.
            let response: Response;
            try {
              response = await fetch(presignedUrl, {
                method: "PUT",
                body: chunk,
                signal: abortController.signal,
              });
            } catch (error) {
              if (abortController.signal.aborted) {
                throw new Error("Upload cancelled");
              }
              const networkMessage =
                error instanceof Error ? error.message : "unknown network error";
              if (attempt === PART_RETRY_ATTEMPTS) {
                throw new Error(
                  `Failed to upload part ${partNumber} after ${PART_RETRY_ATTEMPTS} attempts (network error: ${networkMessage})`
                );
              }
              await new Promise((r) => setTimeout(r, PART_RETRY_BASE_DELAY_MS * attempt));
              continue;
            }

            if (!response.ok) {
              // PR1 (review): 4xx responses (expired presigned URL,
              // bad request, etc.) are deterministic — re-trying just
              // wastes attempts and adds latency before surfacing the
              // real error. Fail fast on client errors; only retry on
              // 5xx or transient failures.
              if (response.status >= 400 && response.status < 500) {
                throw new Error(
                  `Failed to upload part ${partNumber} (HTTP ${response.status}) — client error, not retrying`
                );
              }
              if (attempt === PART_RETRY_ATTEMPTS) {
                throw new Error(
                  `Failed to upload part ${partNumber} (HTTP ${response.status}) after ${PART_RETRY_ATTEMPTS} attempts`
                );
              }
              await new Promise((r) => setTimeout(r, PART_RETRY_BASE_DELAY_MS * attempt));
              continue;
            }

            const etag = response.headers.get("ETag");
            if (!etag) {
              throw new Error(
                `Part ${partNumber} succeeded but the response is missing the required ETag header — likely a proxy/CORS issue`
              );
            }
            return etag;
          }
          throw new Error(`Unreachable: retry loop exited for part ${partNumber}`);
        };

        for (let i = 0; i < totalParts; i++) {
          if (abortController.signal.aborted) {
            throw new Error("Upload cancelled");
          }

          const partNumber = i + 1;
          const start = i * initiateResult.partSize;
          const end = Math.min(start + initiateResult.partSize, file.size);
          const chunk = file.slice(start, end);

          const etag = await uploadPart(partNumber, chunk);
          parts.push({ partNumber, etag });

          const progress = Math.round(((i + 1) / totalParts) * 100);
          setUploadingFiles((prev) =>
            prev.map((f) =>
              f.id === uploadingFile.id
                ? { ...f, progress, uploadedParts: i + 1, parts }
                : f
            )
          );
        }

        await completeUpload(initiateResult.fileId, initiateResult.uploadId, initiateResult.key, parts);

        setUploadingFiles((prev) =>
          prev.map((f) =>
            f.id === uploadingFile.id ? { ...f, status: "completed", progress: 100 } : f
          )
        );

        activeUploadsRef.current--;
        abortControllersRef.current.delete(uploadingFile.id);
        // PR1 (review): decrement the batch counter and only fire
        // `onBatchComplete` once every upload in the most recent drop
        // has settled. The per-file `onUploadComplete` callback fires
        // immediately so callers can still track individual files.
        batchPendingRef.current--;
        if (batchPendingRef.current === 0) {
          onBatchComplete?.();
        }
        onUploadComplete?.();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Upload failed";
        if (message !== "Upload cancelled") {
          setUploadingFiles((prev) =>
            prev.map((f) =>
              f.id === uploadingFile.id
                ? { ...f, status: "error", error: message }
                : f
            )
          );
          try {
            if (initiatedFileId && initiatedUploadId) {
              await abortUpload(initiatedFileId, initiatedUploadId);
            }
          } catch {
            // Ignore abort errors
          }
        }
        activeUploadsRef.current--;
        abortControllersRef.current.delete(uploadingFile.id);
        // PR1 (review): mirror the success path's batch decrement so
        // paused/cancelled uploads still settle the current batch.
        batchPendingRef.current--;
        if (batchPendingRef.current === 0) {
          onBatchComplete?.();
        }
      }
    },
    [onUploadComplete, onBatchComplete, instructorId]
  );

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      setRejectedFiles([]);

      const newFiles: UploadingFile[] = acceptedFiles.map((file) => ({
        id: crypto.randomUUID(),
        file,
        progress: 0,
        status: "pending",
        parts: [],
        uploadedParts: 0,
      }));

      setUploadingFiles((prev) => [...prev, ...newFiles]);

      for (const uploadingFile of newFiles) {
        if (activeUploadsRef.current >= MAX_CONCURRENT_UPLOADS) {
          break;
        }
        activeUploadsRef.current++;
        // PR1 (review): only count files that were actually started so
        // the batch counter matches what `uploadFile` will decrement.
        // Files that didn't fit concurrency stay "pending" in the UI
        // (pre-existing behaviour) and are not part of this batch.
        batchPendingRef.current++;
        setUploadingFiles((prev) =>
          prev.map((f) =>
            f.id === uploadingFile.id ? { ...f, status: "uploading" } : f
          )
        );
        uploadFile(uploadingFile);
      }
    },
    [uploadFile]
  );

  const onDropRejected = useCallback(
    (fileRejections: FileRejection[]) => {
      setRejectedFiles(
        fileRejections.map((rejection) => ({
          file: rejection.file,
          errors: rejection.errors.map((e) => e.message),
        }))
      );
    },
    []
  );

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    onDrop,
    onDropRejected,
    accept: ACCEPTED_VIDEO_TYPES,
    maxFiles: MAX_CONCURRENT_UPLOADS,
    multiple: true,
    validator: (file) => {
      if (file.size > MAX_FILE_SIZE) {
        return {
          code: "file-too-large",
          message: `File too large. Maximum size is 50GB`,
        };
      }
      return null;
    },
  });

  const pauseUpload = useCallback((fileId: string) => {
    const controller = abortControllersRef.current.get(fileId);
    if (controller) {
      controller.abort();
    }
    setUploadingFiles((prev) =>
      prev.map((f) =>
        f.id === fileId ? { ...f, status: "paused" } : f
      )
    );
  }, []);

  const resumeUpload = useCallback(
    (uploadingFile: UploadingFile) => {
      setUploadingFiles((prev) =>
        prev.map((f) =>
          f.id === uploadingFile.id ? { ...f, status: "uploading" } : f
        )
      );
      activeUploadsRef.current++;
      uploadFile(uploadingFile);
    },
    [uploadFile]
  );

  const cancelUpload = useCallback((fileId: string) => {
    const controller = abortControllersRef.current.get(fileId);
    if (controller) {
      controller.abort();
    }
    setUploadingFiles((prev) => prev.filter((f) => f.id !== fileId));
  }, []);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  return (
    <div className="space-y-6">
      <div
        {...getRootProps()}
        className={`
          border-2 border-dashed rounded-xl p-12 text-center cursor-pointer
          transition-all duration-200 ease-in-out
          ${isDragActive && !isDragReject ? "border-emerald-500 bg-emerald-500/10" : ""}
          ${isDragReject ? "border-red-500 bg-red-500/10" : ""}
          ${!isDragActive && !isDragReject ? "border-slate-600 hover:border-emerald-500/50 hover:bg-slate-800/30" : ""}
        `}
      >
        <input {...getInputProps()} />

        <div className="flex flex-col items-center gap-4">
          {isDragActive ? (
            <>
              <Upload className="w-12 h-12 text-emerald-500" />
              <p className="text-lg font-medium text-emerald-500">
                Drop video files here
              </p>
            </>
          ) : isDragReject ? (
            <>
              <AlertCircle className="w-12 h-12 text-red-500" />
              <p className="text-lg font-medium text-red-500">
                Some files will be rejected
              </p>
            </>
          ) : (
            <>
              <Film className="w-12 h-12 text-slate-500" />
              <div>
                <p className="text-lg text-slate-300">
                  Drag & drop video files here, or{" "}
                  <span className="text-emerald-500 font-medium underline">click to browse</span>
                </p>
                <p className="text-sm text-slate-500 mt-2">
                  MP4, MOV, AVI, WebM, MKV, MPEG • Max 50GB • Up to 2 files simultaneously
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {rejectedFiles.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <h3 className="font-medium text-red-400 mb-2">Rejected files:</h3>
          <ul className="space-y-1">
            {rejectedFiles.map(({ file, errors }) => (
              <li key={file.name} className="text-sm text-red-300">
                <span className="font-medium">{file.name}</span>: {errors.join(", ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      {uploadingFiles.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-medium text-slate-300">Uploading Files</h3>
          {uploadingFiles.map((uploadingFile) => (
            <div
              key={uploadingFile.id}
              className={`rounded-lg p-4 border ${
                uploadingFile.status === "error"
                  ? "bg-red-500/10 border-red-500/30"
                  : "bg-slate-800/50 border-slate-700"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <Film className="w-5 h-5 text-emerald-500 mt-0.5 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium text-slate-200 truncate">
                      {uploadingFile.file.name}
                    </p>
                    <p className="text-sm text-slate-400">
                      {formatBytes(uploadingFile.file.size)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {uploadingFile.status === "uploading" && (
                    <button
                      onClick={() => pauseUpload(uploadingFile.id)}
                      className="p-2 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                      title="Pause"
                    >
                      <Pause className="w-4 h-4" />
                    </button>
                  )}
                  {uploadingFile.status === "paused" && (
                    <button
                      onClick={() => resumeUpload(uploadingFile)}
                      className="p-2 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                      title="Resume"
                    >
                      <Play className="w-4 h-4" />
                    </button>
                  )}
                  {(uploadingFile.status === "uploading" ||
                    uploadingFile.status === "paused" ||
                    uploadingFile.status === "pending") && (
                    <button
                      onClick={() => cancelUpload(uploadingFile.id)}
                      className="p-2 rounded-lg hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors"
                      title="Cancel"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {uploadingFile.status === "error" && (
                <div className="mt-3 flex items-center gap-2 text-red-400 text-sm">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span className="flex-1 break-words">{uploadingFile.error}</span>
                </div>
              )}

              <div className="mt-3">
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-slate-400">
                    {uploadingFile.status === "completed"
                      ? "Upload complete"
                      : uploadingFile.status === "error"
                      ? "Upload failed"
                      : uploadingFile.status === "paused"
                      ? "Paused"
                      : `${uploadingFile.progress}%`}
                  </span>
                  <span className="text-slate-500">
                    {uploadingFile.uploadedParts} / {uploadingFile.parts.length > 0 ? uploadingFile.parts.length : Math.ceil(uploadingFile.file.size / (uploadingFile.partSize ?? (100 * 1024 * 1024)))} parts
                  </span>
                </div>
                <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      uploadingFile.status === "completed"
                        ? "bg-emerald-500"
                        : uploadingFile.status === "error"
                        ? "bg-red-500"
                        : "bg-emerald-600"
                    }`}
                    style={{ width: `${uploadingFile.progress}%` }}
                  />
                </div>
              </div>

              {uploadingFile.status === "error" && (
                <div className="mt-3 flex justify-end">
                  <button
                    onClick={() => {
                      if (activeUploadsRef.current >= MAX_CONCURRENT_UPLOADS) {
                        return;
                      }
                      const retryFile: UploadingFile = {
                        ...uploadingFile,
                        id: crypto.randomUUID(),
                        status: "uploading",
                        error: undefined,
                        progress: 0,
                        parts: [],
                        uploadedParts: 0,
                        fileId: undefined,
                        uploadId: undefined,
                      };
                      setUploadingFiles((prev) =>
                        prev.map((f) => (f.id === uploadingFile.id ? retryFile : f))
                      );
                      activeUploadsRef.current++;
                      uploadFile(retryFile);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Retry Upload
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}