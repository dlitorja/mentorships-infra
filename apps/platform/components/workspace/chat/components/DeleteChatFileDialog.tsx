'use client';

import { useState } from 'react';
import { Loader2, Trash2, Download } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useDeleteWorkspaceFileMessage } from '@/lib/queries/convex/use-workspaces';

interface DeleteChatFileDialogProps {
  /**
   * Whether the dialog is open. Parent owns the open state so it can
   * also close on outside click / Escape.
   */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The Convex id of the `workspaceMessages` row to soft-delete.
   */
  messageId: import('@/convex/_generated/dataModel').Id<'workspaceMessages'>;
  /**
   * Display name shown in the dialog. Pre-decoded by the caller
   * (e.g. via `parseFileMessage` / `parseImageMessage`) so we don't
   * duplicate the URL-decoding logic here.
   */
  fileName: string;
  /**
   * The Convex storage URL the message points at. Used by the
   * "Download then delete" branch to trigger the existing
   * client-side download path before the row is soft-deleted.
   */
  fileUrl: string;
  /**
   * The existing chat-download helper. Receives `(url, fileName)`
   * and resolves when the browser has started the download.
   */
  onDownloadFile: (url: string, fileName: string) => Promise<void> | void;
}

/**
 * Two-step delete dialog for chat file/image messages.
 *
 * Step 1 — user picks one of three:
 *   - "Download then delete" (primary): triggers the existing
 *     download path, waits for it, then runs the delete mutation.
 *   - "Delete only" (secondary): skips download, asks for final
 *     confirm.
 *   - "Cancel": closes without action.
 *
 * Step 2 (only shown after "Delete only"): final destructive
 * confirm. The "Download then delete" path skips step 2 because
 * the user has already committed to deletion by choosing the
 * combined action.
 *
 * On success, fires a toast and closes the dialog. On error, fires
 * an error toast and stays open so the user can retry.
 */
export function DeleteChatFileDialog({
  open,
  onOpenChange,
  messageId,
  fileName,
  fileUrl,
  onDownloadFile,
}: DeleteChatFileDialogProps) {
  const [step, setStep] = useState<'choose' | 'confirm-delete-only'>('choose');
  const [isWorking, setIsWorking] = useState(false);
  const deleteMessage = useDeleteWorkspaceFileMessage();

  const handleOpenChange = (next: boolean) => {
    if (isWorking) return;
    if (!next) {
      setStep('choose');
    }
    onOpenChange(next);
  };

  const handleDownloadThenDelete = async () => {
    setIsWorking(true);
    try {
      // `onDownloadFile` throws when the bytes were not streamed
      // (network error, non-200, timeout, abort, or fallback to
      // "open in new tab" — see `downloadFile` in utils.tsx).
      // We must not delete the message if the download failed;
      // otherwise the user loses the only copy of the file.
      await onDownloadFile(fileUrl, fileName);
      await deleteMessage.mutateAsync({ id: messageId });
      toast.success(`Downloaded and deleted "${fileName}".`);
      // Reset `isWorking` BEFORE `onOpenChange(false)` —
      // `handleOpenChange` blocks close attempts while a mutation
      // is in flight, so leaving `isWorking=true` here wedges the
      // dialog in the open state after a successful delete.
      setIsWorking(false);
      onOpenChange(false);
      setStep('choose');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to download or delete the file.');
      setIsWorking(false);
    }
  };

  const handleDeleteOnly = () => {
    setStep('confirm-delete-only');
  };

  const handleConfirmDeleteOnly = async () => {
    setIsWorking(true);
    try {
      await deleteMessage.mutateAsync({ id: messageId });
      toast.success(`Deleted "${fileName}".`);
      setIsWorking(false);
      onOpenChange(false);
      setStep('choose');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete the file.');
      setIsWorking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        {step === 'choose' ? (
          <>
            <DialogHeader>
              <DialogTitle>Delete &ldquo;{fileName}&rdquo;?</DialogTitle>
              <DialogDescription>
                Choose how you&rsquo;d like to handle this file before it&rsquo;s removed from the chat.
                The message stays soft-deleted for 30 days; an admin can restore it from
                the Convex dashboard during that window before storage is reclaimed.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleOpenChange(false)}
                disabled={isWorking}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleDeleteOnly}
                disabled={isWorking}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete only
              </Button>
              <Button
                type="button"
                onClick={handleDownloadThenDelete}
                disabled={isWorking}
              >
                {isWorking ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                Download then delete
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Delete &ldquo;{fileName}&rdquo; permanently?</DialogTitle>
              <DialogDescription>
                This will not download the file first. The message is marked deleted
                immediately; an admin can restore it from the Convex dashboard within the
                next 30 days before storage is reclaimed.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStep('choose')}
                disabled={isWorking}
              >
                Back
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleConfirmDeleteOnly}
                disabled={isWorking}
              >
                {isWorking ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                Delete permanently
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
