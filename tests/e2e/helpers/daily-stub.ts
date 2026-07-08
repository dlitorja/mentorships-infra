import type { Page } from "@playwright/test";

/**
 * Daily iframe stub for `tests/e2e/video-call-mobile.spec.ts`.
 *
 * The real `@daily-co/daily-js` package tries to connect to a Daily
 * backend and create a real iframe. In E2E we don't have a Daily
 * account provisioned for the test environment, so we stub the
 * browser globals that daily-js inspects (`window.Daily`,
 * `window.DailyIframe`) before any app script runs.
 *
 * The stub's `createCallObject()` returns a fake call object that:
 *   - emits `joined-meeting` immediately after `join()` resolves;
 *   - exposes a single local participant with a fake media stream;
 *   - exposes no remote participants (so `<VideoCall>` renders the
 *     "Waiting for the other participant to join…" placeholder);
 *   - supports `leave()`, `setLocalVideo()`, `setLocalAudio()`,
 *     `localParticipant()`, `participants()` as no-ops returning
 *     sane shapes.
 *
 * The goal isn't to exercise the Daily SDK — it's to drive
 * `useVideoCallContext()` into the `joined` state so the React tree
 * renders `<VideoPanel>` and we can assert the breakpoint-driven
 * layout at each viewport.
 *
 * Install with `page.addInitScript` before navigation:
 *
 *   await installDailyStub(page);
 *   await page.goto("/workspace/...");
 */
export async function installDailyStub(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type DailyCallStub = {
      join: () => Promise<void>;
      leave: () => Promise<void>;
      setLocalVideo: (enabled: boolean) => Promise<void>;
      setLocalAudio: (enabled: boolean) => Promise<void>;
      localParticipant: () => unknown;
      participants: () => unknown;
      on: (event: string, handler: (...args: unknown[]) => void) => void;
      off: (event: string, handler: (...args: unknown[]) => void) => void;
    };

    const localParticipant = {
      local: true,
      user_id: "local-stub",
      user_name: "You",
      videoTrackPlayable: true,
      audioTrackPlayable: true,
      video: { state: "playable" },
      audio: { state: "playable" },
    };

    function createCallObject(_options?: unknown): DailyCallStub {
      const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
      const emit = (event: string, ...args: unknown[]): void => {
        const set = listeners.get(event);
        if (!set) return;
        for (const handler of set) handler(...args);
      };
      return {
        join: async () => {
          // Defer to a microtask so consumers can subscribe to
          // 'joined-meeting' between `join()` and the event firing.
          await Promise.resolve();
          emit("joined-meeting", {
            participants: { local: localParticipant },
          });
        },
        leave: async () => {
          emit("left-meeting");
        },
        setLocalVideo: async () => {},
        setLocalAudio: async () => {},
        localParticipant: () => localParticipant,
        participants: () => ({ local: localParticipant }),
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
    // `@daily-co/daily-js` exposes itself via either global depending
    // on the bundle. Stubbing both is harmless.
    (window as unknown as { Daily: typeof dailyGlobal }).Daily = dailyGlobal;
    (window as unknown as { DailyIframe: typeof dailyGlobal }).DailyIframe =
      dailyGlobal;
  });
}
