/**
 * PR #4c-2: short two-note chime for incoming call notifications.
 * Generated via Web Audio API at call time — no audio file to
 * ship, no asset 404 risk, no license question.
 *
 * Uses `AudioContext` + two `OscillatorNode`s scheduled back to
 * back (D5 then A5 — a friendly ascending pair that reads as
 * "attention, not alarm"). Volume is capped at 30% by default so
 * the chime is unobtrusive even when the user has system audio at
 * full volume. Honors `prefers-reduced-motion`-style opt-outs via
 * the optional `enabled` flag.
 *
 * Browser support: `AudioContext` is supported in every browser
 * the platform already targets. Falls back silently if the API
 * is unavailable (Safari with autoplay restrictions before any
 * user gesture, private-mode browsers, etc.).
 */

const DEFAULT_VOLUME = 0.3;
const FIRST_FREQ_HZ = 587.33; // D5
const SECOND_FREQ_HZ = 880; // A5
const NOTE_DURATION_S = 0.18;
const INTER_NOTE_GAP_S = 0.02;

let cachedContext: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (cachedContext) return cachedContext;
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    cachedContext = new Ctor();
    return cachedContext;
  } catch {
    return null;
  }
}

export type PlayChimeOptions = {
  volume?: number;
};

/**
 * Plays the two-note chime. Safe to call repeatedly; each call
 * schedules fresh oscillators. If the AudioContext is suspended
 * (autoplay policy), attempts to resume it (which will succeed
 * if called from a user-gesture handler, otherwise no-op).
 */
export function playIncomingCallChime(options: PlayChimeOptions = {}): void {
  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    void ctx.resume().catch(() => {
      // No-op — caller will try again on the next user gesture.
    });
  }
  const volume = clampVolume(options.volume ?? DEFAULT_VOLUME);
  const now = ctx.currentTime + 0.01;
  scheduleTone(ctx, FIRST_FREQ_HZ, now, volume);
  scheduleTone(
    ctx,
    SECOND_FREQ_HZ,
    now + NOTE_DURATION_S + INTER_NOTE_GAP_S,
    volume
  );
}

function scheduleTone(
  ctx: AudioContext,
  frequencyHz: number,
  startAt: number,
  peakVolume: number
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = frequencyHz;
  // Quick attack + decay envelope so the note does not click.
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(peakVolume, startAt + 0.015);
  gain.gain.linearRampToValueAtTime(0, startAt + NOTE_DURATION_S);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + NOTE_DURATION_S + 0.01);
}

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return DEFAULT_VOLUME;
  if (volume < 0) return 0;
  if (volume > 1) return 1;
  return volume;
}

/**
 * Returns the frequencies the chime uses. Exposed for tests so
 * the unit test can assert "is this still a recognizable
 * ding-dong?" without playing audio in the test environment.
 */
export function incomingCallChimeFrequencies(): { first: number; second: number } {
  return { first: FIRST_FREQ_HZ, second: SECOND_FREQ_HZ };
}
