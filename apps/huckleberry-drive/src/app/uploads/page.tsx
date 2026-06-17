"use client";

import { useState, useRef, useCallback } from "react";
import Link from "next/link";

const ALLOWED_CONTENT_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
  "video/webm",
  "video/x-matroska",
  "video/mpeg",
];

const MAX_FILE_SIZE = 20 * 1024 * 1024 * 1024; // 20GB

interface UploadFile {
  id: string;
  file: File;
  progress: number;
  status: "pending" | "uploading" | "completed" | "error" | "aborted";
  error?: string;
  fileId?: string;
  uploadId?: string;
  key?: string;
}

export default function UploadsPage(): React.ReactElement {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const validateFile = (file: File): string | null => {
    if (!ALLOWED_CONTENT_TYPES.includes(file.type)) {
      return `Invalid file type: ${file.type}. Allowed: video/mp4, video/quicktime, video/x-msvideo, video/webm, video/x-matroska, video/mpeg`;
    }
    if (file.size > MAX_FILE_SIZE) {
      return `File too large: ${formatSize(file.size)}. Maximum is 20GB`;
    }
    return null;
  };

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const validated = Array.from(newFiles).map((file) => {
      const error = validateFile(file);
      return {
        id: crypto.randomUUID(),
        file,
        progress: 0,
        status: error ? ("error" as const) : ("pending" as const),
        error: error ?? undefined,
      };
    });
    setFiles((prev) => [...prev, ...validated]);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }, [addFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
      e.target.value = "";
    }
  }, [addFiles]);

  const uploadFile = async (uploadFile: UploadFile) => {
    setFiles((prev) =>
      prev.map((f) =>
        f.id === uploadFile.id ? { ...f, status: "uploading" as const, progress: 0 } : f
      )
    );

    try {
      // Step 1: Initiate upload
      const initiateRes = await fetch("/api/uploads/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: uploadFile.file.name,
          contentType: uploadFile.file.type,
          size: uploadFile.file.size,
        }),
      });

      if (!initiateRes.ok) {
        const err = await initiateRes.json();
        throw new Error(err.error ?? "Failed to initiate upload");
      }

      const { fileId, uploadId, key, partSize, partCount, presignedUrls } =
        await initiateRes.json();

      setFiles((prev) =>
        prev.map((f) =>
          f.id === uploadFile.id ? { ...f, fileId, uploadId, key, progress: 5 } : f
        )
      );

      // Step 2: Upload parts directly to B2
      const totalParts = presignedUrls.length;
      const parts: { partNumber: number; etag: string }[] = [];

      for (let i = 0; i < presignedUrls.length; i++) {
        const partNumber = i + 1;
        const start = i * partSize;
        const end = Math.min(start + partSize, uploadFile.file.size);
        const chunk = uploadFile.file.slice(start, end);

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", presignedUrls[i]);
          xhr.setRequestHeader("Content-Type", uploadFile.file.type);

          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              const partProgress = (e.loaded / e.total) * 100;
              const overallProgress = 5 + (partProgress / 100) * 80;
              setFiles((prev) =>
                prev.map((f) =>
                  f.id === uploadFile.id ? { ...f, progress: overallProgress } : f
                )
              );
            }
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              const etag = xhr.getResponseHeader("ETag") ?? `"part-${partNumber}"`;
              parts.push({ partNumber, etag });
              resolve();
            } else {
              reject(new Error(`Part ${partNumber} upload failed: ${xhr.status}`));
            }
          };

          xhr.onerror = () => reject(new Error(`Part ${partNumber} network error`));
          xhr.send(chunk);
        });
      }

      setFiles((prev) =>
        prev.map((f) =>
          f.id === uploadFile.id ? { ...f, progress: 85 } : f
        )
      );

      // Step 3: Complete upload
      const completeRes = await fetch("/api/uploads/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId,
          uploadId,
          key,
          parts: parts.sort((a, b) => a.partNumber - b.partNumber),
        }),
      });

      if (!completeRes.ok) {
        const err = await completeRes.json();
        throw new Error(err.error ?? "Failed to complete upload");
      }

      setFiles((prev) =>
        prev.map((f) =>
          f.id === uploadFile.id ? { ...f, progress: 100, status: "completed" as const } : f
        )
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Upload failed";

      // Try to abort the upload
      const uploadFileEntry = files.find((f) => f.id === uploadFile.id);
      if (uploadFileEntry?.fileId && uploadFileEntry?.uploadId && uploadFileEntry?.key) {
        fetch("/api/uploads/abort", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileId: uploadFileEntry.fileId,
            uploadId: uploadFileEntry.uploadId,
            key: uploadFileEntry.key,
          }),
        }).catch(() => {});
      }

      setFiles((prev) =>
        prev.map((f) =>
          f.id === uploadFile.id
            ? { ...f, status: "error" as const, error: errorMessage }
            : f
        )
      );
    }
  };

  const startUploads = useCallback(() => {
    const pending = files.filter((f) => f.status === "pending");
    pending.forEach((f) => uploadFile(f));
  }, [files]);

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const clearCompleted = useCallback(() => {
    setFiles((prev) => prev.filter((f) => f.status !== "completed"));
  }, []);

  const pendingCount = files.filter((f) => f.status === "pending").length;
  const hasInProgress = files.some(
    (f) => f.status === "uploading" || f.status === "pending"
  );

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Upload Files</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              Upload video files up to 20GB each
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              ← Back to Dashboard
            </Link>
          </div>
        </div>
      </header>

      <div className="p-6 max-w-4xl mx-auto">
        {/* Drop Zone */}
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors mb-8 ${
            isDragging
              ? "border-blue-500 bg-blue-500/5"
              : "border-gray-700 hover:border-gray-500 hover:bg-gray-900"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="video/*"
            onChange={handleInputChange}
            className="hidden"
          />
          <div className="text-4xl mb-4">📁</div>
          <p className="text-lg font-medium mb-1">
            {isDragging ? "Drop files here" : "Drag & drop video files here"}
          </p>
          <p className="text-sm text-gray-500">
            or click to browse — MP4, MOV, AVI, WebM, MKV, MPEG up to 20GB
          </p>
        </div>

        {/* File List */}
        {files.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-gray-300">
                {files.length} file{files.length !== 1 ? "s" : ""} —{" "}
                {files.filter((f) => f.status === "completed").length} completed
              </h2>
              <div className="flex items-center gap-3">
                {files.some((f) => f.status === "completed") && (
                  <button
                    onClick={clearCompleted}
                    className="text-xs text-gray-500 hover:text-gray-300"
                  >
                    Clear completed
                  </button>
                )}
                {pendingCount > 0 && !hasInProgress && (
                  <button
                    onClick={startUploads}
                    className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-sm font-medium rounded-lg transition-colors"
                  >
                    Upload {pendingCount} file{pendingCount !== 1 ? "s" : ""}
                  </button>
                )}
              </div>
            </div>

            {files.map((uf) => (
              <div
                key={uf.id}
                className="bg-gray-900 border border-gray-800 rounded-lg p-4"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{uf.file.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {formatSize(uf.file.size)} — {uf.file.type}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    {uf.status === "error" && (
                      <span className="text-xs text-red-400">{uf.error}</span>
                    )}
                    {uf.status !== "uploading" && uf.status !== "completed" && (
                      <button
                        onClick={() => removeFile(uf.id)}
                        className="text-gray-500 hover:text-gray-300 text-sm"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                {(uf.status === "uploading" || uf.status === "pending") && (
                  <div className="mb-2">
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>{uf.status === "pending" ? "Queued" : "Uploading..."}</span>
                      <span>{Math.round(uf.progress)}%</span>
                    </div>
                    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-600 rounded-full transition-all duration-300"
                        style={{ width: `${uf.progress}%` }}
                      />
                    </div>
                  </div>
                )}

                {uf.status === "completed" && (
                  <div className="flex items-center gap-2 text-green-400 text-sm">
                    <span>✓</span>
                    <span>Upload complete</span>
                  </div>
                )}

                {uf.status === "error" && (
                  <div className="flex items-center gap-2">
                    <span className="text-red-400 text-sm">✕ Failed</span>
                    <button
                      onClick={() => {
                        setFiles((prev) =>
                          prev.map((f) =>
                            f.id === uf.id
                              ? { ...f, status: "pending" as const, error: undefined, progress: 0 }
                              : f
                          )
                        );
                        const updatedFile = files.find((f) => f.id === uf.id);
                        if (updatedFile) {
                          uploadFile({ ...updatedFile, status: "pending", progress: 0 });
                        }
                      }}
                      className="text-xs text-blue-400 hover:text-blue-300"
                    >
                      Retry
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Start upload button when files are added but not uploading */}
        {files.length > 0 && pendingCount > 0 && !hasInProgress && (
          <div className="mt-6 flex justify-center">
            <button
              onClick={startUploads}
              className="px-8 py-3 bg-blue-600 hover:bg-blue-500 font-medium rounded-lg transition-colors"
            >
              Start Upload{pendingCount > 1 ? ` ${pendingCount} Files` : ""}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}