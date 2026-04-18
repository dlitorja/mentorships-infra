'use client';

import { useState, useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useWorkspaceDeletionInfo } from '@/lib/queries/convex/use-workspaces';
import { Id } from '../../convex/_generated/dataModel';

type WarningLevel = 'warning' | 'urgent' | 'critical';

interface RetentionWarningBannerProps {
  workspaceId: Id<'workspaces'>;
}

const warningConfig: Record<WarningLevel, { bg: string; border: string; text: string; icon: string }> = {
  warning: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-800',
    icon: 'text-amber-600',
  },
  urgent: {
    bg: 'bg-orange-50',
    border: 'border-orange-200',
    text: 'text-orange-800',
    icon: 'text-orange-600',
  },
  critical: {
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-800',
    icon: 'text-red-600',
  },
};

const warningMessages: Record<WarningLevel, string> = {
  warning: 'This workspace will be deleted in',
  urgent: 'Urgent: This workspace will be deleted in',
  critical: 'CRITICAL: This workspace will be deleted in',
};

export function RetentionWarningBanner({ workspaceId }: RetentionWarningBannerProps) {
  const { data: deletionInfo, isLoading } = useWorkspaceDeletionInfo(workspaceId);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (deletionInfo) {
      const dismissKey = `retention-banner-dismissed-${workspaceId}`;
      const sessionDismissed = sessionStorage.getItem(dismissKey);
      if (sessionDismissed === 'true') {
        setDismissed(true);
      }
    }
  }, [deletionInfo, workspaceId]);

  if (isLoading || !deletionInfo || dismissed) {
    return null;
  }

  const { daysUntilDeletion, warningLevel, workspaceName } = deletionInfo;
  const config = warningConfig[warningLevel];
  const message = warningMessages[warningLevel];

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem(`retention-banner-dismissed-${workspaceId}`, 'true');
  };

  return (
    <div
      className={`${config.bg} ${config.border} border rounded-lg p-4 mb-4 flex items-start gap-3`}
    >
      <AlertTriangle className={`${config.icon} h-5 w-5 shrink-0 mt-0.5`} />
      <div className="flex-1">
        <p className={`${config.text} font-medium`}>
          {message} <span className="font-bold">{daysUntilDeletion} days</span>
        </p>
        <p className={`${config.text} text-sm mt-1`}>
          &quot;{workspaceName}&quot; will be permanently deleted after this period.
          Contact support if you&apos;d like to preserve your content.
        </p>
      </div>
      <button
        onClick={handleDismiss}
        className={`${config.icon} hover:opacity-70 transition-opacity`}
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
