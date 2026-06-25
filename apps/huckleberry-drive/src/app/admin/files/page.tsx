"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, Search, X, Trash2, Download, Play } from "lucide-react";
import { listFilesWithParams, getAdminInstructors, hardDeleteFile, deleteFile, restoreFile, getDownloadUrl, getStreamUrl } from "@/lib/api";
import type { FileItem, InstructorOption, FileListResponse } from "@/lib/api";

export default function AdminFilesPage(): React.ReactElement {
  const [files, setFiles] = useState<FileItem[] | null>(null);
  const [instructors, setInstructors] = useState<InstructorOption[]>([]);
  const [pagination, setPagination] = useState<{ cursor: number | null; hasMore: boolean }>({
    cursor: null,
    hasMore: false,
  });

  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [instructorFilter, setInstructorFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("completed");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");

  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [isHardDeleting, setIsHardDeleting] = useState(false);
  const [isSoftDeleting, setIsSoftDeleting] = useState(false);
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [confirmHardDeleteId, setConfirmHardDeleteId] = useState<string | null>(null);
  const [confirmSoftDeleteId, setConfirmSoftDeleteId] = useState<string | null>(null);
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());
  const [playingIds, setPlayingIds] = useState<Set<string>>(new Set());
  const [playingVideoUrl, setPlayingVideoUrl] = useState<string | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  const latestPlayRequestRef = useRef<string | null>(null);

  const isDownloading = (fileId: string) => downloadingIds.has(fileId);
  const isPlaying = (fileId: string) => playingIds.has(fileId);

  const handlePlay = useCallback(async (file: FileItem) => {
    if (!file.contentType.startsWith("video/")) return;
    setPlayError(null);

    const requestId = `${Date.now()}-${file.id}`;
    latestPlayRequestRef.current = requestId;

    setPlayingIds((prev) => new Set(prev).add(file.id));
    try {
      const url = await getStreamUrl(file.id);
      if (latestPlayRequestRef.current !== requestId) return;
      setPlayingVideoUrl(url);
    } catch (error) {
      if (latestPlayRequestRef.current !== requestId) return;
      console.error("Play failed:", error);
      setPlayError("Failed to load video. Please try again.");
    } finally {
      setPlayingIds((prev) => {
        const next = new Set(prev);
        next.delete(file.id);
        return next;
      });
    }
  }, []);

  const handleDownload = useCallback(async (fileId: string) => {
    setDownloadingIds((prev) => new Set(prev).add(fileId));
    try {
      const url = await getDownloadUrl(fileId);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      console.error("Download failed:", err);
    } finally {
setDownloadingIds((prev) => {
        const next = new Set(prev);
        next.delete(fileId);
        return next;
      });
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const fetchInstructors = useCallback(async () => {
    try {
      const data = await getAdminInstructors();
      setInstructors(data);
    } catch (err) {
      console.error("Failed to fetch instructors:", err);
    }
  }, []);

  const fetchFiles = useCallback(async (cursor?: number, append = false) => {
    try {
      if (!append) setIsLoading(true);
      else setIsLoadingMore(true);
      setError(null);

      const params: Parameters<typeof listFilesWithParams>[0] = {
        status: statusFilter === "all" ? undefined : statusFilter,
        search: debouncedSearch || undefined,
        cursor,
        limit: 50,
      };

      if (instructorFilter) {
        params.instructorId = instructorFilter;
      }

      const result: FileListResponse = await listFilesWithParams(params);

      if (append) {
        setFiles((prev) => [...(prev || []), ...result.files]);
      } else {
        setFiles(result.files);
      }
      setPagination(result.pagination);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load files");
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [instructorFilter, statusFilter, debouncedSearch]);

  useEffect(() => {
    fetchInstructors();
  }, [fetchInstructors]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const handleLoadMore = useCallback(() => {
    if (pagination.cursor !== null) {
      fetchFiles(pagination.cursor, true);
    }
  }, [pagination.cursor, fetchFiles]);

  const handleFilesChange = useCallback(() => {
    setSelectedFileIds(new Set());
    fetchFiles();
  }, [fetchFiles]);

  const handleHardDelete = useCallback(async (fileId: string) => {
    setIsHardDeleting(true);
    try {
      await hardDeleteFile(fileId);
      await handleFilesChange();
    } catch (err) {
      console.error("Hard delete failed:", err);
    } finally {
      setIsHardDeleting(false);
    }
  }, [handleFilesChange]);

  const handleSoftDelete = useCallback(async (fileId: string) => {
    setIsSoftDeleting(true);
    try {
      await deleteFile(fileId);
      await handleFilesChange();
    } catch (err) {
      console.error("Soft delete failed:", err);
    } finally {
      setIsSoftDeleting(false);
      setConfirmSoftDeleteId(null);
    }
  }, [handleFilesChange]);

  const handleBulkHardDelete = useCallback(async () => {
    if (selectedFileIds.size === 0) return;

    setIsHardDeleting(true);
    try {
      const results = await Promise.allSettled(
        Array.from(selectedFileIds).map((id) => hardDeleteFile(id))
      );
      const failures = results.filter((r) => r.status === "rejected");
      if (failures.length > 0) {
        console.error(`${failures.length} hard deletes failed`);
      }
      setSelectedFileIds(new Set());
      setShowBulkConfirm(false);
      await handleFilesChange();
    } catch (err) {
      console.error("Bulk hard delete failed:", err);
    } finally {
      setIsHardDeleting(false);
    }
  }, [selectedFileIds, handleFilesChange]);

  const toggleSelectFile = useCallback((fileId: string) => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        next.add(fileId);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (files === null) return;
    if (selectedFileIds.size === files.length) {
      setSelectedFileIds(new Set());
    } else {
      setSelectedFileIds(new Set(files.map((f) => f.id)));
    }
  }, [files, selectedFileIds.size]);

  const resetFilters = useCallback(() => {
    setInstructorFilter("");
    setStatusFilter("completed");
    setSearchQuery("");
    setDebouncedSearch("");
  }, []);

  const instructorNameMap = instructors.reduce<Record<string, string>>((acc, inst) => {
    acc[inst.id] = inst.name || inst.email;
    return acc;
  }, {});

  const hasActiveFilters = instructorFilter || statusFilter !== "completed" || debouncedSearch;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-100">Files</h1>
        <p className="text-slate-400 mt-1">Manage all uploaded files across instructors</p>
      </div>

      <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-400">Instructor</label>
            <select
              value={instructorFilter}
              onChange={(e) => {
                setInstructorFilter(e.target.value);
setSelectedFileIds(new Set());
                setShowBulkConfirm(false);
                setConfirmHardDeleteId(null);
              }}
              className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-emerald-500"
            >
              <option value="">All Instructors</option>
              {instructors.map((inst) => (
                <option key={inst.id} value={inst.id}>
                  {inst.name || inst.email}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-400">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
setSelectedFileIds(new Set());
                setShowBulkConfirm(false);
                setConfirmHardDeleteId(null);
              }}
              className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-emerald-500"
            >
              <option value="completed">Active</option>
              <option value="deleted">Deleted</option>
              <option value="all">All</option>
            </select>
          </div>

          <div className="flex items-center gap-2 flex-1 min-w-[200px] max-w-md">
            <Search className="w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search by filename..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-emerald-500 w-full"
            />
          </div>

          {hasActiveFilters && (
            <button
              onClick={resetFilters}
              className="flex items-center gap-1 px-3 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
            >
              <X className="w-4 h-4" />
              Reset
            </button>
          )}
        </div>
      </div>

      {selectedFileIds.size > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-center justify-between">
          <span className="text-slate-200">
            {selectedFileIds.size} file{selectedFileIds.size > 1 ? "s" : ""} selected
          </span>
          <div className="flex items-center gap-2">
            {showBulkConfirm ? (
              <>
                <span className="text-sm text-slate-400">This cannot be undone.</span>
                <button
                  onClick={handleBulkHardDelete}
                  disabled={isHardDeleting}
                  className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  {isHardDeleting ? "Deleting..." : "Confirm Delete"}
                </button>
                <button
                  onClick={() => setShowBulkConfirm(false)}
                  className="px-4 py-2 text-sm font-medium bg-slate-600 text-slate-300 rounded-lg hover:bg-slate-500"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setShowBulkConfirm(true)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                <Trash2 className="w-4 h-4" />
                Hard Delete Selected
              </button>
            )}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <Loader2 className="w-12 h-12 border-b-2 border-emerald-500 mx-auto animate-spin" />
            <p className="mt-4 text-slate-400">Loading files...</p>
          </div>
        </div>
      ) : error ? (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-6 text-center">
          <p className="text-red-400">{error}</p>
          <button
            onClick={() => fetchFiles()}
            className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          {files !== null && files.length > 0 && (
            <div className="bg-slate-800/30 border border-slate-700 rounded-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-700 bg-slate-800/50">
                    <th className="px-4 py-3 text-left">
                      <input
                        type="checkbox"
                        checked={files.length > 0 && selectedFileIds.size === files.length}
                        onChange={toggleSelectAll}
                        className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-slate-800"
                      />
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      File
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      Instructor
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      Uploaded By
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      Size
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      Uploaded
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {files.map((file) => {
                    const isSelected = selectedFileIds.has(file.id);
                    return (
                      <tr
                        key={file.id}
                        className={`hover:bg-slate-800/30 transition-colors ${isSelected ? "bg-slate-700/30" : ""}`}
                      >
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectFile(file.id)}
                            className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-slate-800"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-medium text-slate-200 truncate max-w-xs block">
                            {file.originalName}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-400">
                          {instructorNameMap[file.instructorId || ""] || file.instructorId || "-"}
                        </td>
                        <td className="px-4 py-3 text-slate-400">
{file.uploadedById ? "Video Editor" : "-"}
                        </td>
                        <td className="px-4 py-3 text-slate-400">
                          {formatBytes(file.size)}
                        </td>
                        <td className="px-4 py-3">
                          {getStatusBadge(file.status, file.deletedAt)}
                        </td>
                        <td className="px-4 py-3 text-slate-400">
                          {formatDate(file.createdAt)}
                        </td>
                        <td className="px-4 py-3">
<div className="flex items-center justify-end gap-1">
                            {file.status !== "deleted" && file.status !== "deleting" && (
                              <>
                                {file.contentType.startsWith("video/") && (
                                  <button
                                    onClick={() => handlePlay(file)}
                                    disabled={isPlaying(file.id)}
                                    className="p-2 rounded-lg hover:bg-emerald-500/20 text-emerald-400 hover:text-emerald-300 transition-colors disabled:opacity-50 mr-2"
                                    title="Play"
                                    aria-label="Play video"
                                  >
                                    {isPlaying(file.id) ? (
                                      <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                      <Play className="w-4 h-4" />
                                    )}
                                  </button>
                                )}
                                <button
                                  onClick={() => handleDownload(file.id)}
                                  disabled={isDownloading(file.id)}
                                  className="p-2 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors disabled:opacity-50"
                                  aria-label="Download"
                                  title="Download"
                                >
                                  {isDownloading(file.id) ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Download className="w-4 h-4" />
                                  )}
                                </button>
                                {confirmSoftDeleteId === file.id ? (
                                  <>
                                    <button
                                      onClick={() => handleSoftDelete(file.id)}
                                      disabled={isSoftDeleting}
                                      className="px-3 py-1.5 text-xs font-medium bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:opacity-50"
                                    >
                                      {isSoftDeleting ? "Deleting..." : "Confirm"}
                                    </button>
                                    <button
                                      onClick={() => setConfirmSoftDeleteId(null)}
                                      className="px-3 py-1.5 text-xs font-medium bg-slate-600 text-slate-300 rounded-md hover:bg-slate-500"
                                    >
                                      Cancel
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    onClick={() => setConfirmSoftDeleteId(file.id)}
                                    disabled={isSoftDeleting}
                                    className={`p-2 rounded-lg transition-colors ${
                                      isSoftDeleting
                                        ? "opacity-50 cursor-not-allowed text-slate-500"
                                        : "hover:bg-amber-500/20 text-amber-400 hover:text-amber-300"
                                    }`}
                                    title="Delete"
                                    aria-label="Delete"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}
                              </>
                            )}
                            {file.status === "deleted" && (
                              <>
                                {confirmHardDeleteId === file.id ? (
                                  <>
                                    <button
                                      onClick={() => handleHardDelete(file.id)}
                                      disabled={isHardDeleting}
                                      className="px-3 py-1.5 text-xs font-medium bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
                                    >
                                      {isHardDeleting ? "Deleting..." : "Confirm"}
                                    </button>
                                    <button
                                      onClick={() => setConfirmHardDeleteId(null)}
                                      className="px-3 py-1.5 text-xs font-medium bg-slate-600 text-slate-300 rounded-md hover:bg-slate-500"
                                    >
                                      Cancel
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    onClick={() => setConfirmHardDeleteId(file.id)}
                                    className="p-2 rounded-lg hover:bg-red-500/20 text-red-400 hover:text-red-300 transition-colors"
                                    title="Hard Delete"
                                    aria-label="Hard Delete"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {playError ? (
                <div className="mx-4 my-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center justify-between">
                  <span className="text-red-400 text-sm">{playError}</span>
                  <button
                    onClick={() => setPlayError(null)}
                    className="text-slate-400 hover:text-white"
                    aria-label="Dismiss error"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : null}
            </div>
          )}

          {files !== null && files.length === 0 && (
            <div className="text-center py-12 text-slate-500">
              <p className="text-lg">No files found</p>
              {hasActiveFilters && (
                <button
                  onClick={resetFilters}
                  className="mt-2 text-sm text-emerald-400 hover:text-emerald-300"
                >
                  Clear filters
                </button>
              )}
            </div>
          )}

          {pagination.hasMore && (
            <div className="flex justify-center">
              <button
                onClick={handleLoadMore}
                disabled={isLoadingMore}
                className="px-6 py-3 bg-slate-800 border border-slate-700 rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white transition-colors disabled:opacity-50"
              >
                {isLoadingMore ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading...
                  </span>
                ) : (
                  "Load More"
                )}
              </button>
            </div>
          )}
        </>
      )}

      {playingVideoUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setPlayingVideoUrl(null)}
        >
          <div
            className="relative max-w-4xl w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setPlayingVideoUrl(null)}
              className="absolute -top-10 right-0 p-2 text-white hover:text-slate-300"
              aria-label="Close video"
            >
              <X className="w-6 h-6" />
            </button>
            <video
              src={playingVideoUrl}
              controls
              autoPlay
              className="w-full rounded-lg"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getStatusBadge(status: string, deletedAt: number | null | undefined): React.ReactNode {
  const GRACE_PERIOD_DAYS = 60;
  const WARNING_THRESHOLD_DAYS = 50;

  const baseColors: Record<string, string> = {
    completed: "text-emerald-400",
    archived: "text-blue-400",
    deleted: "text-slate-500",
    failed: "text-red-400",
  };

  const color = baseColors[status] || "text-slate-400";
  const text = status === "completed" ? "On B2" : status === "archived" ? "Archived" : status.charAt(0).toUpperCase() + status.slice(1);

  if (status === "deleted" && deletedAt) {
    const daysElapsed = (Date.now() - deletedAt) / (1000 * 60 * 60 * 24);
    const daysRemaining = GRACE_PERIOD_DAYS - daysElapsed;

    return (
      <div className="flex flex-col gap-1">
        <span className={color}>{text}</span>
        {daysRemaining <= WARNING_THRESHOLD_DAYS && daysRemaining > 0 && (
          <span className="text-xs text-amber-400">
            Deletes in {Math.ceil(daysRemaining)} days
          </span>
        )}
      </div>
    );
  }

  return <span className={color}>{text}</span>;
}