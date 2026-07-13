"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Group, Panel, Separator } from "react-resizable-panels";
import { AnimatePresence, motion } from "framer-motion";
import { MessageSquare, FileText, Image as ImageIcon, Link as LinkIcon, FolderArchive } from "lucide-react";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useIsInCall } from "@/lib/video/video-context";
import { useSplitRatio } from "@/lib/hooks/use-split-ratio";
import { useIsBelow } from "@/lib/hooks/use-media-query";
import {
  DEFAULT_HORIZONTAL_SPLIT_RATIO,
  HORIZONTAL_SPLIT_RATIO_STORAGE_KEY,
} from "@/lib/video/constants";
import { VideoPanel } from "@/components/video/video-panel";
import { CallStatusPill } from "@/components/video/call-status-pill";
import { WaitingRoom } from "@/components/video/waiting-room";
import { TabContent } from "@/components/workspace/workspace-client-page";
import type { Id } from "@/convex/_generated/dataModel";
import type { UserRole } from "@/lib/auth-helpers";

export type CallOverlayProps = {
  workspaceId: Id<"workspaces">;
  clerkUserId: string;
  role: UserRole;
  activeSessionId: Id<"sessions"> | null;
  activeTab: string;
  onChangeTab: (tab: string) => void;
};

/**
 * Modal-style call UI that overlays the workspace shell during an
 * active call. Portals to `document.body` so it escapes the
 * `<ProtectedLayout>` 256px sidebar, the `container mx-auto p-6`
 * margins, and the Workspaces card chrome — the call surface claims
 * ~95% of the viewport regardless of the surrounding layout
 * (Zoom/Meet-style).
 *
 * Layout:
 *   - Left panel (~70%): the existing `<VideoPanel>` (Daily iframe
 *     + controls + participant tiles). Default size lives in
 *     `DEFAULT_HORIZONTAL_SPLIT_RATIO`.
 *   - Right panel (~30%): the same `<Tabs>` subtree the workspace
 *     view renders — Chat / Notes / Images / Links / Resources.
 *     `activeTab` + `onChangeTab` are threaded through so the user's
 *     tab selection survives the end-of-call unmount.
 *   - Draggable vertical divider; ratio persists under
 *     `HORIZONTAL_SPLIT_RATIO_STORAGE_KEY` via `useSplitRatio`.
 *
 * Visibility:
 *   - `useIsInCall()` gates mount + unmount with a 180ms
 *     fade-in/fade-out via framer-motion's `AnimatePresence`. We
 *     don't dismiss on Escape or backdrop click — leaving the call
 *     requires the explicit leave button on `<VideoControls>`.
 *
 * SSR safety:
 *   - `createPortal` cannot run server-side; we mount via a
 *     `mounted` flag (set in `useEffect`) to avoid hydration
 *     mismatches. The component returns `null` until then, so SSR
 *     paints the no-overlay state and the client takes over on
 *     hydration.
 */
export function CallOverlay({
  workspaceId,
  clerkUserId,
  role,
  activeSessionId,
  activeTab,
  onChangeTab,
}: CallOverlayProps): React.ReactElement | null {
  const isInCall = useIsInCall();
  const isPhone = useIsBelow(600);
  const { ratio, setRatio } = useSplitRatio(
    HORIZONTAL_SPLIT_RATIO_STORAGE_KEY,
    DEFAULT_HORIZONTAL_SPLIT_RATIO
  );
  // Portals can't render server-side; defer mounting until after
  // hydration. Mirrors the `hasMounted` pattern in `video-panel.tsx`.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  const onLayoutChanged = (layout: { [id: string]: number }): void => {
    // Layout is keyed by panel id (`id="video"` on the left,
    // `id="content"` on the right). We only persist the video panel
    // percentage — `useSplitRatio` derives the right panel as
    // `100 - ratio`.
    const videoPanelSize = layout["video"];
    if (typeof videoPanelSize === "number") {
      setRatio(videoPanelSize);
    }
  };

  // Responsive inset: tighter margins on phones so the overlay can
  // still feel modal on a narrow viewport; more breathing room on
  // larger monitors.
  const insetClass = isPhone ? "inset-2" : "inset-4 md:inset-6";

  return createPortal(
    <AnimatePresence>
      {isInCall && (
        <motion.div
          key="call-overlay"
          data-testid="call-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
        >
          <div
            className={`absolute ${insetClass} flex flex-col rounded-xl bg-background shadow-2xl overflow-hidden`}
          >
            {/* Header: call status pill + waiting-room admit
             * controls. The leave button lives on the existing
             * `<VideoControls>` bar inside the video panel — we
             * intentionally don't duplicate it here so the user has
             * exactly one way to leave the call. */}
            <div className="flex items-center gap-3 px-4 py-2 border-b shrink-0">
              <CallStatusPill />
              <WaitingRoom role={role} />
            </div>

            {/* Body: horizontal split, 70% video / 30% tabs. */}
            <Group
              orientation="horizontal"
              id={`call-overlay-${workspaceId}`}
              onLayoutChanged={onLayoutChanged}
              className="flex-1 min-h-0"
            >
              <Panel id="video" defaultSize={ratio} minSize={20}>
                <VideoPanel className="h-full" />
              </Panel>
              <Separator className="w-1.5 bg-border transition-colors hover:bg-primary" />
              <Panel id="content" defaultSize={100 - ratio} minSize={20}>
                <Tabs
                  value={activeTab}
                  onValueChange={onChangeTab}
                  className="flex flex-col h-full min-h-0"
                >
                  <TabsList className="shrink-0 self-center mx-4 mt-3">
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
                  <TabsContent
                    value={activeTab}
                    className="flex-1 min-h-0 mt-4 px-4 pb-4"
                  >
                    <TabContent
                      workspaceId={workspaceId}
                      clerkUserId={clerkUserId}
                      role={role}
                      activeSessionId={activeSessionId}
                      activeTab={activeTab}
                    />
                  </TabsContent>
                </Tabs>
              </Panel>
            </Group>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
