import { useCallback, useEffect, useState } from "react";

import { MIN_PANEL_WIDTH_PX } from "@/lib/video/constants";

export type UseSplitRatioResult = {
  ratio: number;
  setRatio: (next: number) => void;
  minPanelWidthPx: number;
};

/**
 * Persists a `react-resizable-panels` split ratio (0-100) to
 * localStorage so users keep their preferred panel proportions
 * across reloads. Direction-agnostic — the consumer chooses
 * `<Group orientation="horizontal">` for a left/right split or
 * `<Group orientation="vertical">` for a top/bottom split; this
 * hook just stores the first panel's percentage.
 *
 * Phase 11 (`feat/video-calling-phase-11-vertical-stack`) uses
 * `orientation="vertical"` on desktop, so the persisted ratio is
 * "video panel %" rather than the pre-Phase-11 "chat panel %".
 * The `:v2` suffix on the storage key bumped by Phase 11 keeps
 * existing users from silently inheriting a flipped semantic.
 *
 * No Jotai / Zustand — we use plain useState with manual persistence
 * to keep PR #3's state-management surface minimal. The split ratio is
 * the only piece of UI state we persist; everything else lives in the
 * VideoCallContext.
 */
export function useSplitRatio(
  storageKey: string,
  defaultRatio: number
): UseSplitRatioResult {
  const [ratio, setRatioState] = useState<number>(() => {
    if (typeof window === "undefined") return defaultRatio;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw === null) return defaultRatio;
      const parsed = Number.parseFloat(raw);
      if (!Number.isFinite(parsed)) return defaultRatio;
      if (parsed < 10 || parsed > 90) return defaultRatio;
      return parsed;
    } catch {
      return defaultRatio;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, ratio.toString());
    } catch {
      // localStorage can throw in private browsing; ignore and fall back to in-memory state.
    }
  }, [ratio, storageKey]);

  const setRatio = useCallback((next: number) => {
    const clamped = Math.min(90, Math.max(10, next));
    setRatioState(clamped);
  }, []);

  return {
    ratio,
    setRatio,
    minPanelWidthPx: MIN_PANEL_WIDTH_PX,
  };
}
