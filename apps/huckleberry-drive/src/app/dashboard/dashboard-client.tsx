"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { FileList } from "@/components/file-list";
import { StorageUsage } from "@/components/storage-usage";
import { BulkDownloadBar } from "@/components/bulk-download-bar";
import { BulkDownloadProgress } from "@/components/bulk-download-progress";
import { useBulkDownload } from "@/hooks/use-bulk-download";
import { listFilesWithParams, getStorageUsage } from "@/lib/api";
import type { FileItem, StorageUsage as StorageUsageType, FileListResponse, UserRole } from "@/lib/api";
import { Loader2, Search } from "lucide-react";

interface DashboardClientProps {
  // Server-resolved identity is the source of truth for the dashboard. Clerk
  // publicMetadata can be stale or missing (e.g. for users created before the
  // invitation flow set metadata), which caused the dashboard to skip fetching
  // files entirely for video editors.
  initialUserRole: UserRole | null;
  initialUserId: string | null;
  initialInstructorIds: string[];
}

export function DashboardClient({
  initialUserRole,
  initialUserId,
  initialInstructorIds,
}: DashboardClientProps): React.ReactElement {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [uploadedByMeFiles, setUploadedByMeFiles] = useState<FileItem[]>([]);
  const [storageUsage, setStorageUsage] = useState<StorageUsageType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [cursor, setCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const [uploadedByMeSearchQuery, setUploadedByMeSearchQuery] = useState("");
  const [uploadedByMeDebouncedSearch, setUploadedByMeDebouncedSearch] = useState("");
  const [uploadedByMeCursor, setUploadedByMeCursor] = useState<number | null>(null);
  const [uploadedByMeHasMore, setUploadedByMeHasMore] = useState(false);
  const [isLoadingUploadedByMeMore, setIsLoadingUploadedByMeMore] = useState(false);

  // Track the current request "epoch" for each list. Append requests are only
  // applied if the epoch has not changed since the request started, so a search
  // change invalidates in-flight pagination requests.
  const instructorFilesEpoch = useRef(0);
  const uploadedFilesEpoch = useRef(0);

  // Server-resolved identity is the source of truth for the dashboard. Clerk
  // publicMetadata can be stale or missing, so we do not fall back to it here.
  const userRole = initialUserRole;
  const userId = initialUserId;
  const instructorIds = useMemo(() => initialInstructorIds, [initialInstructorIds]);
  const [selectedInstructorId, setSelectedInstructorId] = useState<string | null>(
    initialInstructorIds[0] ?? null
  );
  // Keep the selected instructor in sync if server-provided assignments change.
  useEffect(() => {
    if (initialInstructorIds.length > 0 && !initialInstructorIds.includes(selectedInstructorId ?? "")) {
      setSelectedInstructorId(initialInstructorIds[0]);
    }
  }, [initialInstructorIds, selectedInstructorId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setUploadedByMeDebouncedSearch(uploadedByMeSearchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [uploadedByMeSearchQuery]);
  const fetchInstructorFiles = useCallback(
    async (search?: string, nextCursor?: number | null, append = false, instructorId?: string) => {
      if (!append) {
        instructorFilesEpoch.current++;
      }
      const requestEpoch = instructorFilesEpoch.current;
      const isCurrentEpoch = () => requestEpoch === instructorFilesEpoch.current;
      try {
        if (!append) setIsLoading(true);
        else setIsLoadingMore(true);
        setError(null);

        const result: FileListResponse = await listFilesWithParams({
          search: search || debouncedSearch || undefined,
          cursor: nextCursor ?? undefined,
          limit: 50,
          instructorId,
        });

        if (!isCurrentEpoch()) return;

        if (append) {
          setFiles((prev) => [...prev, ...result.files]);
        } else {
          setFiles(result.files);
        }
        setCursor(result.pagination.cursor);
        setHasMore(result.pagination.hasMore);
      } catch (err) {
        if (isCurrentEpoch()) {
          setError(err instanceof Error ? err.message : "Failed to load files");
        }
      } finally {
        if (isCurrentEpoch()) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
      }
    },
    [debouncedSearch]
  );

  const fetchVideoEditorUploads = useCallback(
    async (search?: string, nextCursor?: number | null, append = false) => {
      if (!userId) return;
      if (!append) {
        uploadedFilesEpoch.current++;
      }
      const requestEpoch = uploadedFilesEpoch.current;
      const isCurrentEpoch = () => requestEpoch === uploadedFilesEpoch.current;
      try {
        if (!append) setIsLoading(true);
        else setIsLoadingUploadedByMeMore(true);

        const result: FileListResponse = await listFilesWithParams({
          uploadedById: userId,
          status: "completed",
          search: search || uploadedByMeDebouncedSearch || undefined,
          cursor: nextCursor ?? undefined,
          limit: 50,
        });

        if (!isCurrentEpoch()) return;

        if (append) {
          setUploadedByMeFiles((prev) => [...prev, ...result.files]);
        } else {
          setUploadedByMeFiles(result.files);
        }
        setUploadedByMeCursor(result.pagination.cursor);
        setUploadedByMeHasMore(result.pagination.hasMore);
      } catch (err) {
        if (isCurrentEpoch()) {
          console.error("Failed to fetch uploaded files:", err);
          setError(err instanceof Error ? err.message : "Failed to load data");
        }
      } finally {
        if (isCurrentEpoch()) {
          if (!append) setIsLoading(false);
          else setIsLoadingUploadedByMeMore(false);
        }
      }
    },
    [userId, uploadedByMeDebouncedSearch]
  );

  const fetchData = useCallback(async () => {
    try {
      if (userRole !== "video_editor") {
        setIsLoading(true);
      }
      setError(null);

      const [usageData] = await Promise.all([getStorageUsage()]);

      setStorageUsage(usageData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      if (userRole !== "video_editor") {
        setIsLoading(false);
      }
    }
  }, [userRole]);

  useEffect(() => {
    fetchData();
    if (userRole === "instructor" || userRole === "admin") {
      fetchInstructorFiles();
    } else if (userRole === "video_editor") {
      fetchVideoEditorUploads();
      if (selectedInstructorId) {
        fetchInstructorFiles(undefined, undefined, false, selectedInstructorId);
      }
    }
  }, [userRole, fetchData, fetchInstructorFiles, fetchVideoEditorUploads, selectedInstructorId]);

  // Refetch an instructor's file list when the selected instructor changes.
  useEffect(() => {
    if (userRole === "video_editor" && selectedInstructorId) {
      fetchInstructorFiles(undefined, undefined, false, selectedInstructorId);
    }
  }, [selectedInstructorId, userRole, fetchInstructorFiles]);

  useEffect(() => {
    if (userRole === "instructor" || userRole === "admin") {
      fetchInstructorFiles(debouncedSearch, undefined, false);
    }
  }, [debouncedSearch, userRole, fetchInstructorFiles]);

  useEffect(() => {
    if (userRole === "video_editor") {
      fetchVideoEditorUploads(uploadedByMeDebouncedSearch, undefined, false);
    }
  }, [uploadedByMeDebouncedSearch, userRole, fetchVideoEditorUploads]);
  const handleLoadMore = useCallback(() => {
    if (cursor !== null) {
      // Video editors paginate the assigned instructor's file list; pass the
      // instructor id so the cursor is applied to the same query that produced
      // it, not the editor's own-upload list.
      fetchInstructorFiles(debouncedSearch, cursor, true, userRole === "video_editor" ? (selectedInstructorId ?? undefined) : undefined);
    }
  }, [cursor, debouncedSearch, fetchInstructorFiles, userRole, selectedInstructorId]);

  const handleLoadMoreUploadedByMe = useCallback(() => {
    if (uploadedByMeCursor !== null) {
      fetchVideoEditorUploads(uploadedByMeDebouncedSearch, uploadedByMeCursor, true);
    }
  }, [uploadedByMeCursor, uploadedByMeDebouncedSearch, fetchVideoEditorUploads]);
  const handleFilesChange = useCallback(() => {
    if (userRole === "video_editor") {
      fetchVideoEditorUploads();
      if (selectedInstructorId) {
        fetchInstructorFiles(debouncedSearch, undefined, false, selectedInstructorId);
      }
    } else {
      fetchInstructorFiles(debouncedSearch, undefined, false);
    }
  }, [userRole, debouncedSearch, fetchInstructorFiles, fetchVideoEditorUploads, selectedInstructorId]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mx-auto" />
          <p className="mt-4 text-slate-400">Loading your files...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-6 text-center">
        <p className="text-red-400">{error}</p>
        <button
          onClick={() => {
            fetchData();
            handleFilesChange();
          }}
          className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    );
  }

  const renderBulkList = (
    listFiles: FileItem[],
    onChange: () => void
  ): React.ReactElement => (
    <BulkDownloadListSection
      files={listFiles}
      userRole={userRole}
      userId={userId}
      onFilesChange={onChange}
    />
  );

  const renderInstructorView = () => (
    <>
      <div className="flex items-center gap-4 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-slate-200 text-sm focus:outline-none focus:border-emerald-500"
            aria-label="Search files"
          />
        </div>
      </div>

      {renderBulkList(files, handleFilesChange)}

      {hasMore && (
        <div className="flex justify-center mt-4">
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
  );

  const renderVideoEditorView = () => (
    <div className="space-y-8">
      {instructorIds.length > 0 && (
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
            <h2 className="text-xl font-semibold text-slate-200">Instructor&apos;s Files</h2>
            {instructorIds.length > 1 && (
              <div className="flex items-center gap-2">
                <label htmlFor="instructor-select" className="text-sm text-slate-400">
                  Instructor:
                </label>
                <select
                  id="instructor-select"
                  value={selectedInstructorId ?? ""}
                  onChange={(e) => setSelectedInstructorId(e.target.value || null)}
                  className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
                >
                  {instructorIds.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <p className="text-sm text-slate-400 mb-4">
            Viewing files for {instructorIds.length} assigned instructor{instructorIds.length > 1 ? "s" : ""}
          </p>
          {renderBulkList(files, handleFilesChange)}
          {hasMore && (
            <div className="flex justify-center mt-4">
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
        </div>
      )}

      <div>
        <h2 className="text-xl font-semibold text-slate-200 mb-4">Files I Uploaded</h2>
        <div className="relative flex-1 max-w-md mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search files I uploaded..."
            value={uploadedByMeSearchQuery}
            onChange={(e) => setUploadedByMeSearchQuery(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-slate-200 text-sm focus:outline-none focus:border-emerald-500"
            aria-label="Search files I uploaded"
          />
        </div>
        {renderBulkList(uploadedByMeFiles, handleFilesChange)}
        {uploadedByMeHasMore && (
          <div className="flex justify-center mt-4">
            <button
              onClick={handleLoadMoreUploadedByMe}
              disabled={isLoadingUploadedByMeMore}
              className="px-6 py-3 bg-slate-800 border border-slate-700 rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white transition-colors disabled:opacity-50"
            >
              {isLoadingUploadedByMeMore ? (
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
      </div>
    </div>
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-slate-100">Dashboard</h1>
        <p className="text-slate-400 mt-1">Manage your uploaded files</p>
      </div>

      {storageUsage && (
        <StorageUsage
          usedBytes={storageUsage.usedBytes}
          limitBytes={storageUsage.limitBytes}
          fileCount={storageUsage.fileCount}
          instructorCount={storageUsage.instructorCount}
        />
      )}

      {userRole === "video_editor" ? renderVideoEditorView() : renderInstructorView()}
    </div>
  );
}

interface BulkDownloadListSectionProps {
  files: FileItem[];
  userRole: UserRole | null;
  userId: string | null;
  onFilesChange: () => void;
}

function BulkDownloadListSection({
  files,
  userRole,
  userId,
  onFilesChange,
}: BulkDownloadListSectionProps): React.ReactElement {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [prevFiles, setPrevFiles] = useState(files);
  if (prevFiles !== files) {
    setPrevFiles(files);
    setSelectedIds((prev) => {
      const validIds = new Set(files.map((f) => f.id));
      const next = new Set<string>();
      for (const id of prev) {
        if (validIds.has(id)) next.add(id);
      }
      return next;
    });
  }
  const bulk = useBulkDownload();

  const handleFilesChange = useCallback(() => {
    setSelectedIds(new Set());
    onFilesChange();
  }, [onFilesChange]);

  return (
    <>
      <BulkDownloadProgress
        status={bulk.status}
        error={bulk.error}
        isSubmitting={bulk.isSubmitting}
        onDismiss={bulk.reset}
      />
      <FileList
        files={files}
        onFilesChange={handleFilesChange}
        userRole={userRole || undefined}
        userId={userId || undefined}
        enableSelection={userRole !== null}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
      />
      <BulkDownloadBar
        selectedIds={selectedIds}
        status={bulk.status}
        isSubmitting={bulk.isSubmitting}
        isInFlight={bulk.isInFlight}
        onSubmit={() => {
          bulk.submit(Array.from(selectedIds));
          setSelectedIds(new Set());
        }}
        onClearSelection={() => setSelectedIds(new Set())}
      />
    </>
  );
}
