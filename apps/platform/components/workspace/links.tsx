'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { Id } from '../../../../convex/_generated/dataModel';
import {
  useWorkspaceLinksPaginated,
  useSharedLinksForActiveSession,
  useSharedResourcesForActiveSession,
  useCreateWorkspaceLink,
  useDeleteWorkspaceLink,
  useCreateWorkspaceExport,
  useCancelWorkspaceExport,
  useWorkspaceExports,
  useWorkspaceLinkSetUpdatedAt,
  type InstructorResource,
} from '@/lib/queries/convex/use-workspaces';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { sameIdSet } from '@/lib/workspace-export-selection';
import { Loader2, Plus, Trash2, Link as LinkIcon, ExternalLink, Tag, FileText, Download, X } from 'lucide-react';

interface Link {
  _id: Id<'workspaceLinks'>;
  _creationTime: number;
  workspaceId: Id<'workspaces'>;
  url: string;
  title?: string;
  createdBy: string;
  deletedAt?: number;
  sessionId?: Id<'sessions'>;
}

// PR #5: union row type for the subpanel. Each row carries a `kind`
// so the renderer knows whether to render an external link or a
// resource file row. Created in the `useMemo` below.
type SharedRow =
  | { kind: 'link'; data: Link }
  | { kind: 'resource'; data: InstructorResource };

// PR #5: small byte formatter for resource row size labels. Mirrors
// the helper in resources.tsx:23-27 — kept local here because the
// subpanel is a separate component.
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface WorkspaceLinksProps {
  workspaceId: Id<'workspaces'>;
  // PR #4b: id of the active video-call session, or null when no
  // call is active. New links default to being tagged to this
  // session (toggleable per-link).
  activeSessionId: Id<'sessions'> | null;
  // Clerk subject of the signed-in user. Only used to satisfy the
  // export mutation's legacy `userId` arg — the server ignores it in
  // favour of the auth subject.
  currentUserId: string;
}

/**
 * Shared links component for a workspace.
 * Allows users to add and remove URLs that both instructor and student can access.
 * Any active participant can delete links.
 *
 * @param workspaceId - Convex workspace ID
 */
export default function WorkspaceLinks({ workspaceId, activeSessionId, currentUserId }: WorkspaceLinksProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [error, setError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [selectedLinkIds, setSelectedLinkIds] = useState<Set<Id<'workspaceLinks'>>>(new Set());
  const [isDeletingSelected, setIsDeletingSelected] = useState(false);
  const deleteLockRef = useRef(false);
  // PR #4b: per-form "Tag to current call" toggle. Resets to ON
  // every time a call goes active.
  const [tagToCall, setTagToCall] = useState(activeSessionId !== null);
  useEffect(() => {
    setTagToCall(activeSessionId !== null);
  }, [activeSessionId]);

  const linksQuery = useWorkspaceLinksPaginated(workspaceId);
  const links = linksQuery.results;
  const linksStatus = linksQuery.status;
  const canLoadMoreLinks =
    linksStatus === 'CanLoadMore' || linksStatus === 'LoadingMore';
  const isLoadingMoreLinks = linksStatus === 'LoadingMore';
  // PR #4c-3: links tagged to the active session. Returns
  // `undefined` while loading or when no session is active — see
  // the `enabled` guard in `useSharedLinksForActiveSession`.
  // CodeRabbit R1: also surface `error` so a failed fetch shows
  // an explicit error state instead of the misleading empty-state
  // "No links shared yet this call" copy.
  const {
    data: sharedLinks,
    isLoading: sharedLinksLoading,
    isError: sharedLinksErrored,
    error: sharedLinksError,
    refetch: refetchSharedLinks,
  } = useSharedLinksForActiveSession(workspaceId, activeSessionId);
  // PR #5: instructor resources tagged to the active session. Same
  // role-agnostic auth as the links query (assertParticipantForSession
  // server-side), so both instructor and student see them in the
  // subpanel. The Resources tab itself remains instructor-only
  // (workspace-client-page.tsx:272), but the surfacing here widens
  // the reach of shared-during-call content to students.
  const {
    data: sharedResources,
    isLoading: sharedResourcesLoading,
    isError: sharedResourcesErrored,
    error: sharedResourcesError,
    refetch: refetchSharedResources,
  } = useSharedResourcesForActiveSession(workspaceId, activeSessionId);
  const createLink = useCreateWorkspaceLink();
  const deleteLink = useDeleteWorkspaceLink();
  // Links-tab export: a CSV of the shared links, built by the
  // Trigger.dev task `process-workspace-links-export` and stored in B2
  // (never Convex storage). Mirrors the Images tab: one header control
  // for "all links", plus a selection-scoped control in the selection
  // bar.
  const { data: exports } = useWorkspaceExports(workspaceId, "links", false);
  const { data: selectionExports } = useWorkspaceExports(workspaceId, "links", true);
  const createExport = useCreateWorkspaceExport();
  const cancelExport = useCancelWorkspaceExport();
  const { data: linkSetUpdatedAt, isSuccess: linkSetKnown } =
    useWorkspaceLinkSetUpdatedAt(workspaceId);

  const latestSelectionExport = selectionExports?.[0];
  const latestExport = exports?.[0];
  const isExportProcessing = latestExport?.status === 'processing';
  const isExportPending = latestExport?.status === 'pending';
  const isSelectionProcessing = latestSelectionExport?.status === 'processing';
  const isSelectionPending = latestSelectionExport?.status === 'pending';
  const isSelectionInFlight = isSelectionPending || isSelectionProcessing;

  const [nowMs, setNowMs] = useState(() => Date.now());
  const latestExportExpiresAt =
    latestExport?.status === 'completed' ? latestExport.expiresAt : undefined;
  const latestSelectionExpiresAt =
    latestSelectionExport?.status === 'completed'
      ? latestSelectionExport.expiresAt
      : undefined;

  useEffect(() => {
    const upcoming = [latestExportExpiresAt, latestSelectionExpiresAt].filter(
      (value): value is number =>
        typeof value === 'number' && value > Date.now()
    );
    if (upcoming.length === 0) return;
    const next = Math.min(...upcoming);
    const timer = setTimeout(() => setNowMs(Date.now()), next - Date.now() + 1_000);
    return () => clearTimeout(timer);
  }, [
    latestExport?._id,
    latestExport?.status,
    latestExportExpiresAt,
    latestSelectionExport?._id,
    latestSelectionExport?.status,
    latestSelectionExpiresAt,
    nowMs,
  ]);

  const linksExportExpired =
    latestExport?.status === 'completed' &&
    typeof latestExportExpiresAt === 'number' &&
    latestExportExpiresAt <= nowMs;
  // The worker records the link set it built from. Until the freshness
  // query succeeds, don't offer a download that might be stale.
  const linksExportAsOf = latestExport
    ? latestExport.sourceUpdatedAt ?? latestExport._creationTime
    : undefined;
  const linksExportStale =
    latestExport?.status === 'completed' &&
    (!linkSetKnown ||
      (typeof linkSetUpdatedAt === 'number' &&
        typeof linksExportAsOf === 'number' &&
        linksExportAsOf < linkSetUpdatedAt));
  const linksDownloadUrl =
    latestExport?.status === 'completed' &&
    latestExport.downloadUrl &&
    !linksExportExpired &&
    !linksExportStale
      ? latestExport.downloadUrl
      : null;

  const selectionExportExpired =
    latestSelectionExport?.status === 'completed' &&
    typeof latestSelectionExpiresAt === 'number' &&
    latestSelectionExpiresAt <= nowMs;
  // Only offer the selected CSV while the checkboxes still describe
  // the same set it was built from.
  const selectionMatchesCurrent =
    latestSelectionExport !== undefined &&
    sameIdSet(latestSelectionExport.selectionIds, selectedLinkIds);
  const selectionDownloadUrl =
    latestSelectionExport?.status === 'completed' &&
    latestSelectionExport.downloadUrl &&
    !selectionExportExpired &&
    selectionMatchesCurrent
      ? latestSelectionExport.downloadUrl
      : null;

  const activeLinks = useMemo<Link[]>(() => (links as Link[] | undefined) ?? [], [links]);

  useEffect(() => {
    setSelectedLinkIds((prev) => {
      const activeIds = new Set(activeLinks.map((link) => link._id));
      const next = new Set<Id<'workspaceLinks'>>();
      let changed = false;
      for (const id of prev) {
        if (activeIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [activeLinks]);

  // PR #5: union the two server-side results into a single row list
  // for rendering. Sort by `_creationTime` desc so the subpanel
  // matches the order the rest of the workspace uses (most recent
  // first). Both `sharedLinks` and `sharedResources` are themselves
  // sorted desc server-side; merging with `[...a, ...b].sort(...)`
  // gives a stable cross-source order.
  const sharedRows = useMemo<SharedRow[]>(() => {
    const linkRows: SharedRow[] = (sharedLinks ?? []).map((link) => ({
      kind: 'link',
      data: link,
    }));
    const resourceRows: SharedRow[] = (sharedResources ?? []).map((resource) => ({
      kind: 'resource',
      data: resource,
    }));
    return [...linkRows, ...resourceRows].sort((a, b) => {
      const aT = a.data._creationTime;
      const bT = b.data._creationTime;
      return bT - aT;
    });
  }, [sharedLinks, sharedResources]);
  const sharedLoading = sharedLinksLoading || sharedResourcesLoading;
  const sharedErrored = sharedLinksErrored || sharedResourcesErrored;
  const sharedError =
    sharedLinksError instanceof Error
      ? sharedLinksError
      : sharedResourcesError instanceof Error
      ? sharedResourcesError
      : null;

  const isValidUrl = (url: string): boolean => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  };

  const handleAddLink = async () => {
    if (!newUrl.trim()) return;

    const trimmedUrl = newUrl.trim();
    if (!isValidUrl(trimmedUrl)) {
      setError('Please enter a valid URL (e.g., https://example.com)');
      return;
    }

    try {
      await createLink.mutateAsync({
        workspaceId,
        url: trimmedUrl,
        title: newTitle.trim() || undefined,
        // PR #4b: tag to active call when the toggle is ON.
        sessionId: tagToCall && activeSessionId ? activeSessionId : undefined,
      });
      setNewUrl('');
      setNewTitle('');
      setIsAdding(false);
      setError('');
    } catch (err) {
      console.error('Failed to add link:', err);
      setError('Failed to add link. Please try again.');
    }
  };

  const handleDeleteLink = async (linkId: Id<'workspaceLinks'>) => {
    if (deleteLockRef.current) return;
    deleteLockRef.current = true;
    setDeleteError('');
    try {
      await deleteLink.mutateAsync({ id: linkId });
    } catch (err) {
      console.error('Failed to delete link:', err);
      setDeleteError('Failed to delete link. Please try again.');
    } finally {
      deleteLockRef.current = false;
    }
  };

  const toggleLinkSelection = (linkId: Id<'workspaceLinks'>) => {
    setSelectedLinkIds((prev) => {
      const next = new Set(prev);
      if (next.has(linkId)) {
        next.delete(linkId);
      } else {
        next.add(linkId);
      }
      return next;
    });
  };

  const selectLoadedLinks = () => {
    setSelectedLinkIds(new Set(activeLinks.map((link) => link._id)));
  };

  const clearLinkSelection = () => {
    setSelectedLinkIds(new Set());
  };

  const handleDeleteSelected = async () => {
    if (deleteLockRef.current) return;
    deleteLockRef.current = true;
    setDeleteError('');
    const selected = [...selectedLinkIds];
    if (selected.length === 0) {
      deleteLockRef.current = false;
      return;
    }

    const activeSelected = selected.filter((id) => activeLinks.some((link) => link._id === id));
    if (activeSelected.length === 0) {
      toast('Selected links are no longer available.');
      deleteLockRef.current = false;
      return;
    }

    setIsDeletingSelected(true);
    const deletedIds: Id<'workspaceLinks'>[] = [];
    const failedIds: Id<'workspaceLinks'>[] = [];

    try {
      for (const id of activeSelected) {
        try {
          await deleteLink.mutateAsync({ id });
          deletedIds.push(id);
        } catch {
          failedIds.push(id);
        }
      }
    } finally {
      setIsDeletingSelected(false);
      deleteLockRef.current = false;
    }

    setSelectedLinkIds((prev) => {
      const next = new Set(prev);
      for (const id of deletedIds) {
        next.delete(id);
      }
      return next;
    });

    if (deletedIds.length > 0) {
      toast.success(`Deleted ${deletedIds.length} link${deletedIds.length === 1 ? '' : 's'}`);
    }
    if (failedIds.length > 0) {
      setDeleteError(`Failed to delete ${failedIds.length} link${failedIds.length === 1 ? '' : 's'}. Please try again.`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddLink();
    }
  };

  const handleExportCsv = async (linkIds?: Id<'workspaceLinks'>[]): Promise<void> => {
    // One export at a time (full or selection).
    if (
      createExport.isPending ||
      isExportPending ||
      isExportProcessing ||
      isSelectionInFlight
    ) return;
    try {
      const result = await createExport.mutateAsync({
        workspaceId,
        userId: currentUserId,
        format: 'csv',
        scope: 'links',
        ...(linkIds && linkIds.length > 0 ? { linkIds } : {}),
      });
      if (result.errorMessage) {
        toast.error(result.errorMessage);
      } else {
        toast.success(
          linkIds && linkIds.length > 0
            ? 'Building selected links CSV — this usually takes a few seconds.'
            : 'Building links CSV — this usually takes a few seconds.'
        );
      }
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : 'Failed to start the links export.'
      );
    }
  };

  if (linksQuery.isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const selectedCount = selectedLinkIds.size;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
            <Checkbox
              id="select-all-links"
              checked={
                selectedLinkIds.size === 0
                  ? false
                  : selectedLinkIds.size === activeLinks.length
                    ? true
                    : 'indeterminate'
              }
              onCheckedChange={(checked) => {
                if (checked === true) {
                  selectLoadedLinks();
                } else {
                  clearLinkSelection();
                }
              }}
              aria-label="Select loaded links"
            />
            <span className="select-none">Select loaded</span>
          </label>
          <div>
            <h3 className="font-semibold">Shared Links</h3>
            <p className="text-sm text-muted-foreground">
              {canLoadMoreLinks
                ? `${activeLinks.length}+ links`
                : `${activeLinks.length} link${activeLinks.length === 1 ? '' : 's'}`}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {isExportProcessing || isExportPending ? (
            <>
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                Building CSV…
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => latestExport && cancelExport.mutateAsync({ id: latestExport._id })}
                disabled={cancelExport.isPending}
                title="Cancel export"
                aria-label="Cancel links export"
              >
                {cancelExport.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <X className="h-4 w-4" />
                )}
              </Button>
            </>
          ) : linksDownloadUrl ? (
            <Button size="sm" variant="default" asChild>
              <a
                href={linksDownloadUrl}
                download
                onClick={(event) => {
                  if (
                    latestExport?.expiresAt &&
                    latestExport.expiresAt <= Date.now()
                  ) {
                    event.preventDefault();
                    setNowMs(Date.now());
                    toast.error('That CSV link expired. Export again to rebuild it.');
                  }
                }}
              >
                <Download className="h-4 w-4 mr-1" />
                Download CSV
              </a>
            </Button>
          ) : latestExport?.status === 'failed' && latestExport.errorMessage ? (
            <>
              <span
                className="max-w-[16rem] truncate text-xs text-destructive"
                title={latestExport.errorMessage}
              >
                Export failed: {latestExport.errorMessage}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleExportCsv()}
                disabled={createExport.isPending || isSelectionInFlight || activeLinks.length === 0}
              >
                {createExport.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-1" />
                )}
                Retry export
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleExportCsv()}
                disabled={createExport.isPending || isSelectionInFlight || activeLinks.length === 0}
                title={
                  activeLinks.length === 0
                    ? 'Add a link first'
                    : 'Download every shared link as a CSV'
                }
              >
                {createExport.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-1" />
                )}
                Export CSV
              </Button>
              {linksExportStale && (
                <span className="text-xs text-muted-foreground">
                  New links since your last CSV
                </span>
              )}
              {!linksExportStale && linksExportExpired && (
                <span className="text-xs text-muted-foreground">
                  Previous CSV expired
                </span>
              )}
            </>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsAdding(true)}
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Link
          </Button>
        </div>
      </div>
      {deleteError && (
        <div className="mb-3 text-sm text-destructive">{deleteError}</div>
      )}

      {/* Add Link Form */}
      {isAdding && (
        <div className="mb-4 p-4 border rounded-lg bg-muted/50 shrink-0">
          <div className="space-y-3">
            <div>
              <label htmlFor="link-url" className="text-sm font-medium mb-1 block">URL (required)</label>
              <Input
                id="link-url"
                placeholder="https://example.com"
                value={newUrl}
                onChange={(e) => {
                  setNewUrl(e.target.value);
                  setError('');
                }}
                onKeyDown={handleKeyDown}
                autoFocus
              />
            </div>
            <div>
              <label htmlFor="link-title" className="text-sm font-medium mb-1 block">Title (optional)</label>
              <Input
                id="link-title"
                placeholder="Example Website"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={handleKeyDown}
              />
            </div>
            {/* PR #4b: "Tag to current call" toggle, defaults ON
             * while a call is active. */}
            {activeSessionId && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5"
                  checked={tagToCall}
                  onChange={(e) => setTagToCall(e.target.checked)}
                />
                <Tag className="h-3 w-3" />
                Tag to current call
              </label>
            )}
            {error && (
              <div className="text-sm text-destructive">{error}</div>
            )}
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAddLink} disabled={createLink.isPending}>
                {createLink.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4 mr-1" />
                )}
                Add
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setIsAdding(false);
                  setNewUrl('');
                  setNewTitle('');
                  setError('');
                  setTagToCall(activeSessionId !== null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* PR #4c-3 + PR #5: "Shared during current call" subpanel.
       * Renders only while a call is active (`activeSessionId`
       * non-null) and shows links AND instructor resources tagged
       * to this session. PR #4c-3 introduced this block for
       * `workspaceLinks.sessionId`; PR #5 unions
       * `instructorResources.sessionId` so instructors can share
       * "My Resources" files into the same live subpanel. Both
       * roles see it (the underlying queries are role-agnostic;
       * `assertParticipantForSession` enforces participant-only).
       * Visually inset so users can tell it apart from the full
       * history list below. */}
      {activeSessionId && (
        <div
          data-testid="shared-during-call-subpanel"
          className="mb-4 p-3 border rounded-lg bg-primary/5 border-primary/20 shrink-0"
        >
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-red-500 animate-pulse" aria-hidden />
              Shared during current call
            </h4>
            {!sharedLoading && (
              <span className="text-xs text-muted-foreground">
                {sharedRows.length} item{sharedRows.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
          {sharedLoading ? (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : sharedErrored ? (
            // PR #4c-3 CodeRabbit R1: distinguish a fetch failure
            // from an empty result. PR #5 widens the retry button
            // to refetch both sources independently so a transient
            // failure on one doesn't leave the other stale.
            <div className="flex items-center justify-between gap-2 py-1.5">
              <p className="text-xs text-destructive">
                Couldn&apos;t load shared items
                {sharedError ? `: ${sharedError.message}` : "."}
              </p>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  void refetchSharedLinks();
                  void refetchSharedResources();
                }}
              >
                Retry
              </Button>
            </div>
          ) : sharedRows.length > 0 ? (
            <div className="space-y-1.5">
              {sharedRows.map((row) =>
                row.kind === 'link' ? (
                  <div
                    key={row.data._id}
                    className="flex items-center justify-between gap-2 py-1.5 px-2 rounded bg-background/60 hover:bg-background transition-colors"
                    data-testid="shared-during-call-subpanel-row-link"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {/* PR #5: type badge. Link rows get a 🔗 icon
                       * rendered as a LinkIcon; resource rows get a
                       * FileText icon. Keeps the union visually
                       * distinguishable at a glance. */}
                      <LinkIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span
                        className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0"
                        title="Shared link"
                      >
                        Link
                      </span>
                      <a
                        href={row.data.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-primary hover:underline truncate"
                      >
                        {row.data.title || row.data.url}
                      </a>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 shrink-0"
                      asChild
                    >
                      <a
                        href={row.data.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open link"
                        aria-label={`Open ${row.data.title || row.data.url} in a new tab`}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                  </div>
                ) : (
                  <div
                    key={row.data._id}
                    className="flex items-center justify-between gap-2 py-1.5 px-2 rounded bg-background/60 hover:bg-background transition-colors"
                    data-testid="shared-during-call-subpanel-row-resource"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span
                        className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0"
                        title="Shared resource"
                      >
                        Resource
                      </span>
                      {row.data.url ? (
                        <a
                          href={row.data.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium text-primary hover:underline truncate"
                        >
                          {row.data.fileName}
                        </a>
                      ) : (
                        <span
                          className="text-sm font-medium text-muted-foreground truncate"
                          title="Resource URL unavailable"
                        >
                          {row.data.fileName}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {formatBytes(row.data.size)}
                    </span>
                  </div>
                )
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground py-1.5">
              No links or resources shared yet this call
            </p>
          )}
        </div>
      )}

      {/* Links List */}
      <div className="flex-1 overflow-y-auto">
        {activeLinks.length > 0 ? (
          <>
            <div className="space-y-2">
              {activeLinks.map((link: Link) => {
                const isTaggedToCall =
                  !!activeSessionId && link.sessionId === activeSessionId;
                return (
                  <Card key={link._id} className="hover:bg-muted/50 transition-colors">
                    <CardContent className="p-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <Checkbox
                          checked={selectedLinkIds.has(link._id)}
                          onCheckedChange={() => toggleLinkSelection(link._id)}
                          aria-label={`Select link ${link.title || link.url}`}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <LinkIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-primary hover:underline block truncate"
                        >
                          {link.title || link.url}
                        </a>
                        <p className="text-xs text-muted-foreground truncate">
                          {link.url}
                        </p>
                      </div>
                      {/* PR #4b: "Tagged" badge while a call is active
                       * AND the link was tagged to it. */}
                      {isTaggedToCall && (
                        <span
                          className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/20 text-primary shrink-0"
                          title="Tagged to current call"
                        >
                          Tagged
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        asChild
                      >
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open link"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => handleDeleteLink(link._id)}
                        disabled={isDeletingSelected || deleteLink.isPending}
                        title="Delete link"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
              })}
            </div>
            {selectedCount > 0 && (
              <div className="sticky bottom-4 z-30 mt-4 flex justify-center">
                <div className="flex items-center gap-3 rounded-lg border bg-background/95 px-4 py-2 shadow-lg backdrop-blur">
                  <span className="text-sm font-medium">
                    {selectedCount} selected
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={clearLinkSelection}
                  >
                    Clear
                  </Button>
                  {isSelectionInFlight ? (
                    <>
                      <span className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        Building selected CSV…
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          latestSelectionExport &&
                          cancelExport.mutateAsync({ id: latestSelectionExport._id })
                        }
                        disabled={cancelExport.isPending}
                        aria-label="Cancel selected links export"
                      >
                        {cancelExport.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <X className="h-4 w-4" />
                        )}
                      </Button>
                    </>
                  ) : (
                    <>
                      {latestSelectionExport?.status === 'failed' &&
                        latestSelectionExport.errorMessage && (
                          <span
                            className="max-w-[14rem] truncate text-xs text-destructive"
                            title={latestSelectionExport.errorMessage}
                          >
                            Selected export failed
                          </span>
                        )}
                      {selectionDownloadUrl && (
                        <Button variant="default" size="sm" asChild>
                          <a
                            href={selectionDownloadUrl}
                            download
                            onClick={(event) => {
                              if (
                                latestSelectionExport?.expiresAt &&
                                latestSelectionExport.expiresAt <= Date.now()
                              ) {
                                event.preventDefault();
                                setNowMs(Date.now());
                                toast.error(
                                  'That selected CSV expired. Export the selection again.'
                                );
                              }
                            }}
                          >
                            <Download className="h-4 w-4 mr-2" />
                            Download selected CSV
                          </a>
                        </Button>
                      )}
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleExportCsv([...selectedLinkIds])}
                        disabled={
                          createExport.isPending ||
                          isExportPending ||
                          isExportProcessing
                        }
                      >
                        {createExport.isPending && (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        )}
                        Export selected
                      </Button>
                    </>
                  )}
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleDeleteSelected}
                    disabled={isDeletingSelected || deleteLink.isPending}
                  >
                    {isDeletingSelected && (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    )}
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete selected
                  </Button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-muted-foreground">
              <LinkIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No links shared yet</p>
              <p className="text-sm">Add useful links to share with your instructor</p>
            </div>
          </div>
        )}
        {canLoadMoreLinks && (
          <div className="mt-4 flex justify-center">
            <Button
              variant="outline"
              onClick={() => linksQuery.loadMore(50)}
              disabled={isLoadingMoreLinks}
            >
              {isLoadingMoreLinks && (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              )}
              Load more links
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}