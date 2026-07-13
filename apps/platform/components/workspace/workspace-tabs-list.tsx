"use client";

import { MessageSquare, FileText, Image as ImageIcon, Link as LinkIcon, FolderArchive } from "lucide-react";

import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/lib/auth-helpers";

export type WorkspaceTabsListProps = {
  role: UserRole;
  /**
   * Layout-only className applied to the `<TabsList>` wrapper so each
   * caller can tune spacing (e.g. `mx-4 mt-3` inside the modal, default
   * centering for the inline workspace view). Trigger markup stays
   * identical so a future tab addition only needs to update this file.
   */
  className?: string;
};

/**
 * Shared `<TabsList>` markup for the workspace surface and the call
 * overlay's right panel. The activeTab → component mapping is already
 * shared via the exported `TabContent` from `workspace-client-page.tsx`
 * — keeping the trigger strip shared here prevents the two surfaces
 * from drifting (a tab added in one place but forgotten in the other).
 *
 * Resources is gated on `role !== "student"` to match the historical
 * instructor-only access. Chat / Notes / Images / Links are always
 * visible.
 */
export function WorkspaceTabsList({
  role,
  className,
}: WorkspaceTabsListProps): React.ReactElement {
  return (
    <TabsList className={cn("shrink-0 self-center", className)}>
      <TabsTrigger value="chat" className="gap-2">
        <MessageSquare className="h-4 w-4" />
        Chat
      </TabsTrigger>
      <TabsTrigger value="notes" className="gap-2">
        <FileText className="h-4 w-4" />
        Notes
      </TabsTrigger>
      <TabsTrigger value="images" className="gap-2">
        <ImageIcon className="h-4 w-4" />
        Images
      </TabsTrigger>
      <TabsTrigger value="links" className="gap-2">
        <LinkIcon className="h-4 w-4" />
        Links
      </TabsTrigger>
      {role !== "student" && (
        <TabsTrigger value="resources" className="gap-2">
          <FolderArchive className="h-4 w-4" />
          My Resources
        </TabsTrigger>
      )}
    </TabsList>
  );
}
