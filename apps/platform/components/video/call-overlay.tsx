"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Group, Panel, Separator } from "react-resizable-panels";
import { AnimatePresence, motion } from "framer-motion";

import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useIsCallOverlayVisible } from "@/lib/video/video-context";
import { useSplitRatio } from "@/lib/hooks/use-split-ratio";
import { useIsBelow } from "@/lib/hooks/use-media-query";
import {
  DEFAULT_HORIZONTAL_SPLIT_RATIO,
  HORIZONTAL_SPLIT_RATIO_STORAGE_KEY,
  MIN_PANEL_WIDTH_PX,
} from "@/lib/video/constants";
import { VideoCall } from "@/components/video/video-call";
import { CallStatusPill } from "@/components/video/call-status-pill";
import { WaitingRoom } from "@/components/video/waiting-room";
import { TabContent } from "@/components/workspace/workspace-client-page";
import { WorkspaceTabsList } from "@/components/workspace/workspace-tabs-list";
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
 *   - Video on the left/right (default 70% of the panel) and the
 *     `<Tabs>` subtree (Chat / Notes / Images / Links / Resources) on
 *     the opposite side (default 30%). Draggable divider, ratio
 *     persists under `HORIZONTAL_SPLIT_RATIO_STORAGE_KEY` via
 *     `useSplitRatio`. Below 600px we flip to a vertical split so
 *     the video gets full width and the tabs sit underneath.
 *   - On phones the video surfaces the same `<VideoCall />` directly
 *     (no `<VideoPanel />`) so the call UI stays inside the modal's
 *     flex chain. Using `<VideoPanel />` would force a fixed
 *     viewport-positioned fullscreen surface and escape the modal —
 *     Greptile P1.
 *   - `defaultSize` is a percentage string (`"70%"`). Numeric values
 *     are interpreted as pixels by react-resizable-panels v4
 *     (`node_modules/.../Panel.d.ts`) so `defaultSize={70}` would
 *     render a 70px panel.
 *
 * Visibility:
 *   - `useIsCallOverlayVisible()` gates mount + unmount with a 180ms
 *     fade-in/fade-out via framer-motion's `AnimatePresence`. We
 *     don't dismiss on Escape or backdrop click — leaving the call
 *     requires the explicit leave button on `<VideoControls>`.
 *
 *     The hook (vs. `useIsInCall()`) is load-bearing here: React 18
 *     automatic batching collapses `setStatus("joining")` and the
 *     terminal `setStatus` (joined or error) from `useVideoCall.join()`
 *     into a single commit when the token fetch resolves in the
 *     same microtask. Without the broader hook (which also matches
 *     `session.status === "active"` and `status === "error"`), the
 *     overlay would flash off whenever the join failed and the user
 *     would have to hard-refresh.
 *
 * Accessibility:
 *   - `role="dialog"` + `aria-modal="true"` + `aria-label` so screen
 *     readers announce the modal and treat siblings as background.
 *     A full focus trap + `inert` on the workspace behind is a
 *     follow-up (Radix Dialog swap) — CodeRabbit flagged it as out of
 *     scope for this PR.
 *   - We don't dismiss on Escape or backdrop click — leaving the call
 *     requires the explicit leave button on `<VideoControls>`.
 *
 * SSR safety:
 *   - `createPortal` cannot run server-side; we mount via a
 *     `mounted` flag (set in `useEffect`) to avoid hydration
 *     mismatches. The component returns `null` until then.
 */
export function CallOverlay({
  workspaceId,
  clerkUserId,
  role,
  activeSessionId,
  activeTab,
  onChangeTab,
}: CallOverlayProps): React.ReactElement | null {
  const isVisible = useIsCallOverlayVisible();
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
  // Flip to a vertical split on phones so the video column gets the
  // full overlay width instead of being squeezed into a 30% column
  // alongside a 5-trigger tab strip.
  const groupOrientation = isPhone ? "vertical" : "horizontal";
  // Percentage strings for sizes — react-resizable-panels treats
  // numeric values as pixels.
  const videoSizeStr = `${ratio}%`;
  const contentSizeStr = `${100 - ratio}%`;
  const minSizePx = `${MIN_PANEL_WIDTH_PX}px`;

  return createPortal(
    <AnimatePresence>
      {isVisible && (
        <motion.div
          key="call-overlay"
          data-testid="call-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Video call"
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

            {/* Body: split. Horizontal on tablet/desktop (video
             * left, tabs right, default 70/30), vertical on phones
             * (video on top, tabs underneath). */}
            <Group
              orientation={groupOrientation}
              id={`call-overlay-${workspaceId}`}
              onLayoutChanged={onLayoutChanged}
              className="flex-1 min-h-0"
            >
              <Panel id="video" defaultSize={videoSizeStr} minSize={minSizePx}>
                <div className="relative h-full w-full overflow-hidden bg-black">
                  <VideoCall />
                </div>
              </Panel>
              <Separator className={isPhone ? "h-1.5 bg-border transition-colors hover:bg-primary" : "w-1.5 bg-border transition-colors hover:bg-primary"} />
              <Panel id="content" defaultSize={contentSizeStr} minSize={minSizePx}>
                <Tabs
                  value={activeTab}
                  onValueChange={onChangeTab}
                  className="flex flex-col h-full min-h-0"
                >
                  <WorkspaceTabsList role={role} className={isPhone ? undefined : "mx-4 mt-3"} />
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
