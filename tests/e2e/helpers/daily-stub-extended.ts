import type { Page } from "@playwright/test";

/**
 * Extended Daily iframe stub for the 5-call-bug regression spec.
 *
 * Builds on `daily-stub.ts` (which drives `useVideoCallContext()` into
 * the `joined` state for the existing layout tests) and adds opt-in
 * behaviors needed to reproduce the bugs PR #629 + #630 fixed.
 *
 * ## How daily-react derives screen-share state
 *
 * `useParticipantIds({ filter: "screen" })` matches participants
 * whose `tracks.screenAudio.state !== "off" ||
 * tracks.screenVideo.state !== "off"`. The matched IDs are the
 * OWNER session_ids — Daily also creates a sub-participant with id
 * `${ownerId}-screen` whose `tracks.screenVideo` mirrors the
 * owner's. `<VideoCall>` reads both via `useParticipantIds()` and
 * `useParticipantIds({ filter: "screen" })` to compute the layout.
 *
 * To simulate `startScreenShare()` we therefore need to:
 *   1. Flip the owner's `tracks.screenVideo.state` to "playable"
 *      so `useParticipantIds({ filter: "screen" })` matches it.
 *   2. Add a sub-participant with id `${ownerId}-screen` so the
 *      full `participantIds()` list contains both records.
 *
 * The methods below mutate the stub's internal participant list and
 * emit a `participant-joined` event so daily-react's Jotai store
 * picks up the change.
 *
 * Install with `page.addInitScript` before navigation:
 *
 *   await installExtendedDailyStub(page);
 *   await page.goto("/workspace/...");
 */
export async function installExtendedDailyStub(
  page: Page
): Promise<void> {
  await page.addInitScript(() => {
    type DailyCallStub = {
      join: () => Promise<void>;
      leave: () => Promise<void>;
      setLocalVideo: (enabled: boolean) => Promise<void>;
      setLocalAudio: (enabled: boolean) => Promise<void>;
      startScreenShare: () => Promise<void>;
      stopScreenShare: () => Promise<void>;
      localParticipant: () => unknown;
      participants: () => unknown;
      on: (event: string, handler: (...args: unknown[]) => void) => void;
      off: (event: string, handler: (...args: unknown[]) => void) => void;
    };

    const ownerId = "local-stub";
    const remoteParticipants: Array<Record<string, unknown>> = [];
    let screenShareActive = false;

    function buildOwner(): Record<string, unknown> {
      return {
        session_id: ownerId,
        user_id: ownerId,
        user_name: "You",
        local: true,
        videoTrackPlayable: true,
        audioTrackPlayable: true,
        video: { state: "playable" },
        audio: { state: "playable" },
        tracks: {
          video: { state: "playable" },
          audio: { state: "playable" },
          screenAudio: { state: "off" },
          screenVideo: screenShareActive
            ? { state: "playable", persistentTrack: {} }
            : { state: "off", persistentTrack: null },
        },
      };
    }

    function buildScreenSub(): Record<string, unknown> {
      return {
        session_id: `${ownerId}-screen`,
        user_id: `${ownerId}-screen`,
        user_name: "Your screen",
        local: false,
        video: { state: "playable" },
        audio: { state: "playable" },
        tracks: {
          screenVideo: {
            state: "playable",
            persistentTrack: {},
          },
        },
      };
    }

    function buildParticipantList(): Record<string, unknown> {
      // daily-react's Jotai store keys the local participant under
      // BOTH "local" (the legacy alias from daily-js) and the actual
      // session_id. Emitting only the session_id key — as the base
      // `daily-stub.ts` line 66 does — leaves daily-react unable to
      // resolve `localParticipant()` post-join. Keying both avoids
      // that race without affecting remote-participant lookups.
      const list: Record<string, unknown> = {
        local: buildOwner(),
        [ownerId]: buildOwner(),
      };
      for (const r of remoteParticipants) {
        list[r["session_id"] as string] = r;
      }
      if (screenShareActive) {
        list[`${ownerId}-screen`] = buildScreenSub();
      }
      return list;
    }

    function createCallObject(_options?: unknown): DailyCallStub {
      const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
      const emit = (event: string, ...args: unknown[]): void => {
        const set = listeners.get(event);
        if (!set) return;
        for (const handler of set) handler(...args);
      };
      return {
        join: async () => {
          await Promise.resolve();
          emit("joined-meeting", {
            participants: buildParticipantList(),
          });
        },
        leave: async () => {
          screenShareActive = false;
          remoteParticipants.length = 0;
          emit("left-meeting");
        },
        setLocalVideo: async () => {},
        setLocalAudio: async () => {},
        startScreenShare: async () => {
          if (screenShareActive) return;
          screenShareActive = true;
          emit("local-screen-share-started");
          // daily-react's `useParticipantIds({ filter: "screen" })`
          // matches owners whose `tracks.screenVideo.state !==
          // "off"`. The Jotai store reacts to BOTH
          // `participant-joined` (new sub-participant) AND
          // `participant-updated` (owner track state change). Emit
          // both so the filter picks up the screen-share state in
          // the same render.
          emit("participant-updated", {
            participant: buildOwner(),
          });
          emit("participant-joined", {
            participant: buildScreenSub(),
          });
        },
        stopScreenShare: async () => {
          if (!screenShareActive) return;
          screenShareActive = false;
          emit("local-screen-share-stopped");
          emit("participant-updated", {
            participant: buildOwner(),
          });
          // `session_id` (snake_case) matches the keys
          // participant-joined used when the sub-participant was
          // added — daily-react's cleanup handler matches on
          // session_id, not the legacy camelCase `sessionId`.
          emit("participant-left", {
            participant: { session_id: `${ownerId}-screen` },
          });
        },
        localParticipant: () => buildOwner(),
        participants: () => buildParticipantList(),
        on: (event, handler) => {
          if (!listeners.has(event)) listeners.set(event, new Set());
          listeners.get(event)!.add(handler);
        },
        off: (event, handler) => {
          listeners.get(event)?.delete(handler);
        },
      };
    }

    const dailyGlobal = { createCallObject };
    (window as unknown as { Daily: typeof dailyGlobal }).Daily = dailyGlobal;
    (window as unknown as { DailyIframe: typeof dailyGlobal }).DailyIframe =
      dailyGlobal;
  });
}
