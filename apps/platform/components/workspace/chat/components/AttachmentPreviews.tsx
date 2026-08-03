'use client';

import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { AlertCircle, RefreshCw, X, FileText, Send } from 'lucide-react';
import { clsx } from 'clsx';
import { formatBytes } from '../utils';
import type { AttachmentPreviewsProps } from '../types';

/**
 * Renders a preview strip of files queued for sending in the chat composer.
 */
export function AttachmentPreviews({
  attachments,
  isUploading,
  onSend,
  onRetryAll,
  onCancel,
  onRemove,
  onRetry,
}: AttachmentPreviewsProps) {
  const failedCount = attachments.filter((attachment) => attachment.error).length;

  if (attachments.length === 0 || isUploading) return null;

  return (
    <div className="p-3 border-t bg-muted/50">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">
          {failedCount > 0 ? `${failedCount} failed` : `${attachments.length} attachment${attachments.length !== 1 ? 's' : ''} ready`}
        </span>
        {failedCount > 1 && (
          <Button size="sm" variant="outline" onClick={onRetryAll}>
            <RefreshCw className="h-3 w-3 mr-1" />
            Retry All
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {attachments.map((attachment, index) => (
          <div key={`${attachment.file.name}-${index}`} className="relative group" title={attachment.error}>
            {attachment.isImage && attachment.preview ? (
              <Image
                src={attachment.preview}
                alt={`Preview ${index + 1}`}
                width={80}
                height={80}
                unoptimized
                className={clsx(
                  'h-20 w-20 object-cover rounded-md border',
                  attachment.error ? 'border-red-500' : 'border-muted'
                )}
              />
            ) : (
              <div className={clsx(
                'h-20 w-44 rounded-md border bg-background p-2 flex items-center gap-2',
                attachment.error ? 'border-red-500' : 'border-muted'
              )}>
                <FileText className="h-6 w-6 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{attachment.file.name}</p>
                  <p className="text-xs text-muted-foreground">{formatBytes(attachment.file.size)}</p>
                </div>
              </div>
            )}
            {attachment.error ? (
              <>
                <div className="absolute inset-0 bg-black/50 rounded-md flex items-center justify-center">
                  <AlertCircle className="h-6 w-6 text-red-500" />
                </div>
                <Button
                  size="icon"
                  variant="secondary"
                  className="h-6 w-6 absolute -top-2 -right-2"
                  onClick={() => onRetry(attachment, index)}
                  aria-label={`Retry uploading ${attachment.file.name}`}
                >
                  <RefreshCw className="h-3 w-3" />
                </Button>
              </>
            ) : (
              <Button
                size="icon"
                variant="destructive"
                className="h-6 w-6 absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onRemove(index)}
                aria-label={`Remove ${attachment.file.name} from attachments`}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <Button size="sm" onClick={onSend} disabled={isUploading} aria-label={`Send ${attachments.length} attachment${attachments.length !== 1 ? 's' : ''}`}>
          <Send className="h-4 w-4 mr-1" />
          Send {attachments.length} Attachment{attachments.length !== 1 ? 's' : ''}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} aria-label="Cancel all attachments">
          Cancel
        </Button>
      </div>
    </div>
  );
}
