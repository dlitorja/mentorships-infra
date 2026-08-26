"use client";

import { useState } from "react";
import { PhoneCall, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useConvexMutation } from "@convex-dev/react-query";

import { Button } from "@/components/ui/button";
import { ConsentModal } from "@/components/video/consent-modal";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { convexIdSchema } from "@/lib/validators";
import { reportError } from "@/lib/observability";
import { useVideoCallContext } from "@/lib/video/video-context";
import { startAdhocCall } from "@/lib/queries/api-client";

export type StartAdhocButtonProps = {
  workspaceId: Id<"workspaces">;
};

const startAdhocResponseSchema = z.object({
  sessionId: convexIdSchema,
  roomName: z.string().min(1),
  roomUrl: z.string().url(),
});

/**
 * Large "Start video call" button shown in the workspace header when no
 * call session exists yet. Both instructors and students can start an
 * ad-hoc call; the server enforces the caller is a workspace participant.
 *
 * Flow:
 *   1. Open the consent modal (default recording = ON per
 *      `docs/plans/video-calling.md:343`).
 *   2. On confirm, POST /api/video/start-adhoc to create the synthetic
 *      session row and provision the Daily room.
 *   3. Call `markCallStarted` to flip the session to `status: "active"`.
 *   4. Request a provider-level join via `requestJoin(sessionId)`. The
 *      provider's gated auto-join effect brings the user into the call
 *      once the active session is visible.
 *
 * Visibility: only rendered when there is no current session. The call
 * status indicator / Join button takes over once a session exists.
 */
export function StartAdhocButton({
  workspaceId,
}: StartAdhocButtonProps): React.ReactElement | null {
  const [modalOpen, setModalOpen] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const { session, requestJoin } = useVideoCallContext();
  const queryClient = useQueryClient();
  const markCallStarted = useMutation({
    mutationFn: useConvexMutation(api.sessions.markCallStarted),
    // Invalidate the active-session query so the provider's gated
    // requestJoin effect sees the active session and brings the user
    // into the call immediately after this mutation completes.
    // Convex's reactive subscription
    // usually pushes updates on its own, but the previous "scheduled"
    // row in the TanStack Query cache holds a stale shape until either
    // (a) the subscription pushes a `setQueryData` (race-prone on first
    // Start click because the cached row's identity is the empty-
    // videoRoomName version), or (b) this onSuccess force-marks the
    // query as stale and refetches. We do BOTH:
    //   - Predicate on `["convexQuery", "sessions:..."]` so the
    //     full set of session queries refetch — including the
    //     provider's `getCurrentOrUpcomingSessionForWorkspace` query
    //     and the deep-link `getSessionById` query, both of which the
    //     provider's own `markCallStarted` mutation also touches.
    //     The `sessions:` prefix matches Convex's `getFunctionName`
    //     output format ("path:export", e.g. `sessions:markCallStarted`).
    //     Using the `["sessions"]` prefix from earlier was a partial-
    //     match no-op because the actual keys live under
    //     `["convexQuery", ...]` (see `@convex-dev/react-query`'s
    //     `convexQuery` factory, `queryKey: ["convexQuery",
    //     functionName, args]`).
    //   - `{ refetchType: "all" }` so unobserved queries refetch too
    //     (default `refetchType: "active"` skips them).
    onSuccess: () => {
      queryClient.invalidateQueries({
        predicate: (q) =>
          q.queryKey[0] === "convexQuery" &&
          typeof q.queryKey[1] === "string" &&
          q.queryKey[1].startsWith("sessions:"),
        refetchType: "all",
      });
    },
  });

  // Only show the start affordance when there is no session. Once a
  // session exists (joinable/active/error), the call-status indicator
  // and Join button take over.
  if (session) {
    return null;
  }

  const startAdhoc = async (recordingConsent: boolean): Promise<void> => {
    setIsStarting(true);
    try {
      const body = startAdhocResponseSchema.parse(await startAdhocCall({ workspaceId, recordingConsent }));
      await markCallStarted.mutateAsync({
        sessionId: body.sessionId as Id<"sessions">,
      });
      // Ask the provider to bring us into the call once the new
      // session is visible as active.
      requestJoin(body.sessionId as Id<"sessions">);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await reportError({
        source: "StartAdhocButton",
        error: err instanceof Error ? err : new Error(message),
        level: "error",
        message: "Failed to start call",
        context: { workspaceId, recordingConsent },
      });
      toast.error("Could not start call", { description: message });
    } finally {
      setIsStarting(false);
      // Close the modal so the next open gets a fresh `hasChosen=false`
      // (the ConsentModal only resets on `open` flipping to true).
      setModalOpen(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="default"
        size="lg"
        onClick={() => setModalOpen(true)}
        disabled={isStarting}
        className="bg-blue-600 text-white hover:bg-blue-700 font-semibold text-base shadow-sm"
      >
        {isStarting ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <PhoneCall className="h-5 w-5" />
        )}
        Start video call
      </Button>
      <ConsentModal
        open={modalOpen}
        defaultRecording={true}
        onResolved={(consent) => {
          void startAdhoc(consent);
        }}
        onCancel={() => {
          setModalOpen(false);
          setIsStarting(false);
        }}
      />
    </>
  );
}
