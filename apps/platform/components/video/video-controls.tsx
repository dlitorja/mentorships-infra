"use client";

import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  ScreenShare,
  PhoneOff,
  PictureInPicture,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useVideoCallContext } from "@/lib/video/video-context";

/**
 * Bottom-center control bar for the in-call VideoPanel.
 *
 * Buttons map to Daily calls (mute/camera/screen-share/leave) and a
 * local PiP toggle. Each button shows a tooltip-style hint with its
 * keyboard shortcut from `lib/video/constants.ts`.
 *
 * All buttons disable while the call is in `joining` or `leaving`
 * state to prevent double-clicks racing the Daily transition.
 */
export function VideoControls() {
  const {
    status,
    isMuted,
    isCameraOff,
    isScreenSharing,
    isPictureInPicture,
    toggleMute,
    toggleCamera,
    toggleScreenShare,
    togglePictureInPicture,
    leave,
  } = useVideoCallContext();

  const disabled = status === "joining" || status === "leaving" || status === "idle";

  return (
    <div className="flex items-center justify-center gap-2 rounded-full border bg-background/95 px-3 py-2 shadow-sm backdrop-blur">
      <Button
        type="button"
        variant={isMuted ? "destructive" : "secondary"}
        size="icon"
        onClick={toggleMute}
        disabled={disabled}
        title={isMuted ? "Unmute (M)" : "Mute (M)"}
        aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
      >
        {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
      </Button>
      <Button
        type="button"
        variant={isCameraOff ? "destructive" : "secondary"}
        size="icon"
        onClick={toggleCamera}
        disabled={disabled}
        title={isCameraOff ? "Turn camera on (V)" : "Turn camera off (V)"}
        aria-label={isCameraOff ? "Turn camera on" : "Turn camera off"}
      >
        {isCameraOff ? <VideoOff className="h-4 w-4" /> : <Video className="h-4 w-4" />}
      </Button>
      <Button
        type="button"
        variant={isScreenSharing ? "default" : "secondary"}
        size="icon"
        onClick={toggleScreenShare}
        disabled={disabled}
        title={isScreenSharing ? "Stop screen share (S)" : "Start screen share (S)"}
        aria-label={isScreenSharing ? "Stop screen share" : "Start screen share"}
      >
        <ScreenShare className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant={isPictureInPicture ? "default" : "secondary"}
        size="icon"
        onClick={togglePictureInPicture}
        title={isPictureInPicture ? "Exit picture-in-picture (P)" : "Enter picture-in-picture (P)"}
        aria-label={isPictureInPicture ? "Exit picture-in-picture" : "Enter picture-in-picture"}
      >
        <PictureInPicture className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="destructive"
        size="icon"
        onClick={() => void leave()}
        disabled={disabled}
        title="Leave call (Esc)"
        aria-label="Leave call"
      >
        <PhoneOff className="h-4 w-4" />
      </Button>
    </div>
  );
}
