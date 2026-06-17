"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface FileItem {
  id: string;
  originalName: string;
  contentType: string;
  size: number;
  status: string;
  transferStatus: string | null;
  createdAt: number | null;
  archivedAt: number | null;
  errorMessage: string | null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(timestamp: number | null): string {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-yellow-900/50 text-yellow-300",
    uploading: "bg-blue-900/50 text-blue-300",
    completed: "bg-green-900/50 text-green-300",
    archived: "bg-orange-900/50 text-orange-300",
    failed: "bg-red-900/50 text-red-300",
    deleted: "bg-gray-800 text-gray-400",
  };
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
        styles[status] ?? "bg-gray-800 text-gray-300"
      }`}
    >
      {status}
    </span>
  );
}

export default function DashboardPage(): React.ReactElement {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const fetchFiles = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/files");
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to load files");
      }
      const data = await res.json();
      setFiles(data.files);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load files");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const handleDownload = async (file: FileItem) => {
    setDownloadingId(file.id);
    try {
      const res = await fetch(`/api/download/${file.id}?expiresIn=3600`);
      if (res.status === 410) {
        alert("This file is archived in cold storage. Contact an admin to restore it.");
        return;
      }
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to get download URL");
      }
      const { url } = await res.json();
      window.open(url, "_blank");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDelete = async (file: FileItem) => {
    if (!confirm(`Delete "${file.originalName}"? This cannot be undone.`)) {
      return;
    }
    setDeletingId(file.id);
    try {
      const res = await fetch(`/api/files/${file.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to delete file");
      }
      setFiles((prev) => prev.filter((f) => f.id !== file.id));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">My Files</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              {files.length} file{files.length !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/uploads"
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-sm font-medium rounded-lg transition-colors"
            >
              Upload Files
            </Link>
          </div>
        </div>
      </header>

      <div className="p-6 max-w-5xl mx-auto">
        {loading && (
          <div className="text-center py-20 text-gray-500">Loading files...</div>
        )}

        {error && (
          <div className="text-center py-20">
            <p className="text-red-400 mb-4">{error}</p>
            <button
              onClick={fetchFiles}
              className="text-sm text-blue-400 hover:text-blue-300"
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && files.length === 0 && (
          <div className="text-center py-20">
            <div className="text-5xl mb-4">📂</div>
            <h2 className="text-lg font-medium mb-2">No files yet</h2>
            <p className="text-gray-500 mb-6">
              Upload your first video file to get started
            </p>
            <Link
              href="/uploads"
              className="inline-flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-500 text-sm font-medium rounded-lg transition-colors"
            >
              Upload Files
            </Link>
          </div>
        )}

        {!loading && !error && files.length > 0 && (
          <div className="border border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-900">
                  <th className="text-left px-4 py-3 font-medium text-gray-400">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-400">Size</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-400">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-400">Uploaded</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-400">Actions</th>
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr
                    key={file.id}
                    className="border-b border-gray-800 last:border-0 hover:bg-gray-900/50 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-300 truncate max-w-xs">
                          {file.originalName}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-400">{formatSize(file.size)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={file.status} />
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {formatDate(file.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {file.status === "archived" ? (
                          <span className="text-xs text-orange-400">
                            Archived — contact admin
                          </span>
                        ) : file.status === "completed" ? (
                          <>
                            <button
                              onClick={() => handleDownload(file)}
                              disabled={downloadingId === file.id}
                              className="text-xs px-3 py-1 rounded-md bg-gray-800 hover:bg-gray-700 transition-colors disabled:opacity-50"
                            >
                              {downloadingId === file.id ? "Getting link..." : "Download"}
                            </button>
                            <button
                              onClick={() => handleDelete(file)}
                              disabled={deletingId === file.id}
                              className="text-xs px-3 py-1 rounded-md bg-red-900/30 text-red-400 hover:bg-red-900/50 transition-colors disabled:opacity-50"
                            >
                              {deletingId === file.id ? "Deleting..." : "Delete"}
                            </button>
                          </>
                        ) : (
                          <span className="text-xs text-gray-500">
                            {file.status === "uploading" ? "Uploading..." : file.status}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}