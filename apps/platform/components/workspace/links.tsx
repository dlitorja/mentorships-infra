'use client';

import { useState, useEffect } from 'react';
import { Id } from '../../../../convex/_generated/dataModel';
import {
  useWorkspaceLinks,
  useCreateWorkspaceLink,
  useDeleteWorkspaceLink
} from '@/lib/queries/convex/use-workspaces';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Plus, Trash2, Link as LinkIcon, ExternalLink, Tag } from 'lucide-react';

interface Link {
  _id: Id<'workspaceLinks'>;
  workspaceId: Id<'workspaces'>;
  url: string;
  title?: string;
  createdBy: string;
  deletedAt?: number;
  sessionId?: Id<'sessions'>;
}

interface WorkspaceLinksProps {
  workspaceId: Id<'workspaces'>;
  currentUserId: string;
  // PR #4b: id of the active video-call session, or null when no
  // call is active. New links default to being tagged to this
  // session (toggleable per-link).
  activeSessionId: Id<'sessions'> | null;
}

/**
 * Shared links component for a workspace.
 * Allows users to add and remove URLs that both instructor and student can access.
 * Only the author can delete their own links.
 *
 * @param workspaceId - Convex workspace ID
 * @param currentUserId - Current authenticated user's ID
 */
export default function WorkspaceLinks({ workspaceId, currentUserId, activeSessionId }: WorkspaceLinksProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [error, setError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  // PR #4b: per-form "Tag to current call" toggle. Resets to ON
  // every time a call goes active.
  const [tagToCall, setTagToCall] = useState(activeSessionId !== null);
  useEffect(() => {
    setTagToCall(activeSessionId !== null);
  }, [activeSessionId]);

  const { data: links, isLoading } = useWorkspaceLinks(workspaceId);
  const createLink = useCreateWorkspaceLink();
  const deleteLink = useDeleteWorkspaceLink();

  const activeLinks = links?.filter((link: Link) => !link.deletedAt) || [];

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
    setDeleteError('');
    try {
      await deleteLink.mutateAsync({ id: linkId });
    } catch (err) {
      console.error('Failed to delete link:', err);
      setDeleteError('Failed to delete link. Please try again.');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddLink();
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h3 className="font-semibold">Shared Links</h3>
          <p className="text-sm text-muted-foreground">
            {activeLinks.length} link{activeLinks.length === 1 ? '' : 's'}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setIsAdding(true)}
        >
          <Plus className="h-4 w-4 mr-1" />
          Add Link
        </Button>
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

      {/* Links List */}
      <div className="flex-1 overflow-y-auto">
        {activeLinks.length > 0 ? (
          <div className="space-y-2">
            {activeLinks.map((link: Link) => {
              const isTaggedToCall =
                !!activeSessionId && link.sessionId === activeSessionId;
              return (
                <Card key={link._id} className="hover:bg-muted/50 transition-colors">
                  <CardContent className="p-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
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
                      {link.createdBy === currentUserId && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => handleDeleteLink(link._id)}
                          title="Delete link"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-muted-foreground">
              <LinkIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No links shared yet</p>
              <p className="text-sm">Add useful links to share with your instructor</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}