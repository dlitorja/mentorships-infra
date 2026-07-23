"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useUser } from "@clerk/nextjs";
import { FileList } from "@/components/file-list";
import { StorageUsage } from "@/components/storage-usage";
import { BulkDownloadBar } from "@/components/bulk-download-bar";
import { BulkDownloadProgress } from "@/components/bulk-download-progress";
import { useBulkDownload } from "@/hooks/use-bulk-download";
import { listFilesWithParams, getStorageUsage } from "@/lib/api";
import type { FileItem, StorageUsage as StorageUsageType, FileListResponse, UserRole } from "@/lib/api";
import { Loader2, Search } from "lucide-react";

export default function DashboardPage(): React.ReactElement {
  const { user, isLoaded } = useUser();
  const [files, setFiles] = useState<FileItem[]>([]);
  const [uploadedByMeFiles, setUploadedByMeFiles] = useState<FileItem[]>([]);
  const [storageUsage, setStorageUsage] = useState<StorageUsageType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // PR1: reconcile Clerk publicMetadata with the latest server state.
  // Without this, an admin changing a user's role in Clerk or assigning
  // video-editor instructors isn't reflected until the page is hard
  // refreshed. We re-fetch Clerk user on window focus and once every
  // 60 seconds (matches Clerk's own cache TTL behavior).
  useEffect(() => {
    if (!isLoaded || !user) return;
    const onFocus = () => {
      user.reload().catch((err) => {
        console.warn("Failed to reload Clerk user:", err);
      });
    };
    const interval = setInterval(() => {
      user.reload().catch((err) => {
        console.warn("Failed to reload Clerk user:", err);
      });
    }, 60_000);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(interval);
    };
  }, [isLoaded, user]);

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [cursor, setCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);

const [uploadedByMeSearchQuery, setUploadedByMeSearchQuery] = useState("");
  const [uploadedByMeDebouncedSearch, setUploadedByMeDebouncedSearch] = useState("");
  const [uploadedByMeCursor, setUploadedByMeCursor] = useState<number | null>(null);
  const [uploadedByMeHasMore, setUploadedByMeHasMore] = useState(false);
  const [isLoadingUploadedByMeMore, setIsLoadingUploadedByMeMore] = useState(false);
  const userRole = (user?.publicMetadata?.role as UserRole) || null;
  const userId = user?.id || null;
  const instructorIds = useMemo(
    () => ((user?.publicMetadata?.instructorIds as string[] | undefined) ?? []),
    [user?.publicMetadata?.instructorIds]
  );
  const primaryInstructorId = useMemo(
    () => instructorIds[0] ?? null,
    [instructorIds]
  );

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

        if (append) {
          setFiles((prev) => [...prev, ...result.files]);
        } else {
          setFiles(result.files);
        }
        setCursor(result.pagination.cursor);
        setHasMore(result.pagination.hasMore);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load files");
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [debouncedSearch]
  );

const fetchVideoEditorUploads = useCallback(
    async (search?: string, nextCursor?: number | null, append = false) => {
      if (!userId) return;
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

        if (append) {
          setUploadedByMeFiles((prev) => [...prev, ...result.files]);
        } else {
          setUploadedByMeFiles(result.files);
        }
        setUploadedByMeCursor(result.pagination.cursor);
        setUploadedByMeHasMore(result.pagination.hasMore);
      } catch (err) {
        console.error("Failed to fetch uploaded files:", err);
setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        if (!append) setIsLoading(false);
        else setIsLoadingUploadedByMeMore(false);
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
    if (isLoaded && user) {
      fetchData();
      if (userRole === "instructor" || userRole === "admin") {
        fetchInstructorFiles();
      } else if (userRole === "video_editor") {
        fetchVideoEditorUploads();
        if (primaryInstructorId) {
          fetchInstructorFiles(undefined, undefined, false, primaryInstructorId);
        }
      }
    }
  }, [isLoaded, user, userRole, fetchData, fetchInstructorFiles, fetchVideoEditorUploads, primaryInstructorId]);

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
      fetchInstructorFiles(debouncedSearch, cursor, true);
    }
  }, [cursor, debouncedSearch, fetchInstructorFiles]);

const handleLoadMoreUploadedByMe = useCallback(() => {
    if (uploadedByMeCursor !== null) {
      fetchVideoEditorUploads(uploadedByMeDebouncedSearch, uploadedByMeCursor, true);
    }
  }, [uploadedByMeCursor, uploadedByMeDebouncedSearch, fetchVideoEditorUploads]);
  const handleFilesChange = useCallback(() => {
    if (userRole === "video_editor") {
      fetchVideoEditorUploads();
      if (instructorIds.length > 0) {
        fetchInstructorFiles(debouncedSearch, undefined, false, instructorIds[0]);
      }
    } else {
      fetchInstructorFiles(debouncedSearch, undefined, false);
    }
  }, [userRole, debouncedSearch, fetchInstructorFiles, fetchVideoEditorUploads, instructorIds]);

  if (!isLoaded || isLoading) {
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
          <h2 className="text-xl font-semibold text-slate-200 mb-4">Instructor&apos;s Files</h2>
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
    setSelectedIds(new Set());
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
        onSubmit={() => bulk.submit(Array.from(selectedIds))}
        onClearSelection={() => setSelectedIds(new Set())}
      />
    </>
  );
}