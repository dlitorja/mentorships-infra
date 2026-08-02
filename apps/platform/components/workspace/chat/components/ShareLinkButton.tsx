'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Link as LinkIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useCreateWorkspaceLink } from '@/lib/queries/convex/use-workspaces';
import { normalizeUrl } from '../utils';
import type { ShareLinkButtonProps } from '../types';

export function ShareLinkButton({ urls, workspaceId, activeSessionId }: ShareLinkButtonProps) {
  const createLink = useCreateWorkspaceLink();
  const [sharedUrls, setSharedUrls] = useState<Set<string>>(new Set());

  const handleShare = async (url: string) => {
    try {
      const normalizedUrl = normalizeUrl(url);
      await createLink.mutateAsync({
        workspaceId,
        url: normalizedUrl,
        sessionId: activeSessionId ?? undefined,
      });
      setSharedUrls((prev) => new Set(prev).add(normalizedUrl));
      toast.success('Link shared to Links tab');
    } catch (error) {
      console.error('Failed to share link:', error);
      toast.error('Failed to share link');
    }
  };

  if (urls.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {urls.map((url, index) => {
        const isShared = sharedUrls.has(normalizeUrl(url));
        return (
          <Button
            key={index}
            variant="ghost"
            size="sm"
            className="h-6 text-xs py-0 px-1.5"
            onClick={() => handleShare(url)}
            disabled={isShared || createLink.isPending}
          >
            <LinkIcon className="h-3 w-3 mr-0.5" />
            {isShared ? 'Shared' : 'Share to Links'}
          </Button>
        );
      })}
    </div>
  );
}
