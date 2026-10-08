"use client";

import * as React from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { cn } from "../lib/utils";

export interface ClerkUserIdCellProps {
  /** The Clerk resource id (e.g. `user_abc123` for users, `inv_abc123` for invitations). */
  id: string;
  /** Truncate display to this many leading characters. `0` renders the full id. Default: 8. */
  truncateAt?: number;
  /** Render the copy-to-clipboard button. Default: true. */
  showCopyButton?: boolean;
  /** Render the "Open in Clerk" dashboard link. Hidden when `dashboardUrl` is null. Default: true. */
  showDashboardLink?: boolean;
  /** Optional label rendered above the id (e.g. `instructor.userId`). */
  label?: string;
  /** Pre-computed dashboard URL. Pass `null` to disable the link. */
  dashboardUrl?: string | null;
  /** Layout direction. Default: row. */
  orientation?: "row" | "column";
  className?: string;
}

const TRUNCATION_SUFFIX = "…";

/**
 * Render a Clerk resource id (user, invitation, etc.) with copy-to-clipboard
 * and an optional deep link to the Clerk dashboard. Centralises the display so
 * admin/instructor screens stay consistent and we never hand-roll a
 * slice-prefix truncation inline.
 *
 * The dashboard URL is passed in by the caller (typically computed from
 * `NEXT_PUBLIC_CLERK_APP_ID`); the package does not read Clerk env vars so it
 * stays portable to apps that don't ship a Clerk integration.
 */
export function ClerkUserIdCell({
  id,
  truncateAt = 8,
  showCopyButton = true,
  showDashboardLink = true,
  label,
  dashboardUrl,
  orientation = "row",
  className,
}: ClerkUserIdCellProps) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can fail in insecure contexts or if the user denied
      // permission; silently no-op rather than throw inside a render tree.
    }
  }, [id]);

  const displayId =
    truncateAt > 0 && id.length > truncateAt
      ? `${id.slice(0, truncateAt)}${TRUNCATION_SUFFIX}`
      : id;

  const fullIdForTitle =
    truncateAt > 0 && id.length > truncateAt ? id : undefined;

  const showLink = showDashboardLink && dashboardUrl;

  return (
    <div
      className={cn(
        "flex gap-2",
        orientation === "column" ? "flex-col" : "flex-row items-center",
        className,
      )}
    >
      <div className="flex flex-col gap-1 min-w-0">
        {label && <span className="text-xs text-muted-foreground">{label}</span>}
        <code
          className={cn(
            "font-mono text-xs bg-muted px-1.5 py-0.5 rounded inline-block",
            truncateAt > 0 ? "max-w-[14rem] truncate" : "whitespace-normal break-all",
          )}
          title={fullIdForTitle}
        >
          {displayId}
        </code>
      </div>
      <div className="flex gap-1">
        {showCopyButton && (
          <button
            type="button"
            onClick={handleCopy}
            aria-label={copied ? "Copied" : `Copy Clerk id ${id}`}
            title={copied ? "Copied" : "Copy id"}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-colors"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        )}
        {showLink && (
          <a
            href={dashboardUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${id} in Clerk dashboard`}
            title="Open in Clerk dashboard"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}
