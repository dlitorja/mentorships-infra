"use client";

import { createContext, useContext } from "react";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * Mirror of `convex/sessions.CurrentOrUpcomingSession` for client-side
 * consumption. Kept in sync manually because the Convex codegen only
 * re-exports function references through `api`, not types.
 */
export type CurrentOrUpcomingSession = {
  sessionId: Id<"sessions">;
  scheduledAt: number;
  status: "active" | "joinable" | "scheduled";
  startedAt: number | null;
  videoRoomName: string | null;
  videoRoomUrl: string | null;
  participantName: string;
  windowOpensAt: number;
  windowClosesAt: number;
};

/**
 * Snapshot of the call state shared via `VideoCallContext`.
 *
 * The provider owns the call state (Daily ref + UI flags) and exposes
 * it through React Context so child components (`VideoPanel`, PiP,
 * `CallStatusPill`) can subscribe without prop drilling. One ticker
 * drives durationSeconds — only the components that render it re-render.
 */
export type VideoCallContextValue = {
  workspaceId: Id<"workspaces"> | null;
  session: CurrentOrUpcomingSession | null;
  status: "idle" | "joining" | "joined" | "leaving" | "error" | "ended";
  isMuted: boolean;
  isCameraOff: boolean;
  isScreenSharing: boolean;
  isPictureInPicture: boolean;
  participantCount: number;
  remoteParticipantName: string | null;
  errorMessage: string | null;
  durationSeconds: number;
  join: () => Promise<void>;
  leave: () => Promise<void>;
  toggleMute: () => void;
  toggleCamera: () => void;
  toggleScreenShare: () => void;
  togglePictureInPicture: () => void;
};

export const VideoCallContext = createContext<VideoCallContextValue | null>(null);

export function useVideoCallContext(): VideoCallContextValue {
  const ctx = useContext(VideoCallContext);
  if (!ctx) {
    throw new Error(
      "useVideoCallContext must be used within a <VideoCallProvider>"
    );
  }
  return ctx;
}
