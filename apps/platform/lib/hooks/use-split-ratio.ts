import { useEffect, useState } from "react";

import { MIN_PANEL_WIDTH_PX } from "@/lib/video/constants";

/**
 * Persists a horizontal split ratio (0-100) to localStorage so users
 * keep their preferred chat/video panel proportions across reloads.
 *
 * No Jotai / Zustand — we use plain useState with manual persistence
 * to keep PR #3's state-management surface minimal. The split ratio is
 * the only piece of UI state we persist; everything else lives in the
 * VideoCallContext.
 */
export function useSplitRatio(storageKey: string, defaultRatio: number) {
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

  const setRatio = (next: number) => {
    const clamped = Math.min(90, Math.max(10, next));
    setRatioState(clamped);
  };

  return {
    ratio,
    setRatio,
    minPanelWidthPx: MIN_PANEL_WIDTH_PX,
  };
}
