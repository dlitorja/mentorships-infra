"use client";

import { useEffect, useState } from "react";

/**
 * Subscribe to a CSS media query and return whether it currently matches.
 *
 * Returns `null` until the first client-side measurement so SSR does not
 * paint a layout based on a guessed viewport width. Components should
 * treat `null` as "unknown" and pick a sensible default (typically the
 * desktop branch) until the first event fires.
 *
 * Uses the modern `addEventListener("change", …)` API. The deprecated
 * `addListener` form throws on Safari ≥ 14.
 */
export function useMediaQuery(query: string): boolean | null {
  const [matches, setMatches] = useState<boolean | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/**
 * Returns `true` when the viewport width is below `px` pixels.
 *
 * PR #4c-4: the video-call layout splits on two breakpoints
 * (`< 900px` PiP-only, `< 600px` full-screen + bottom-sheet drawer).
 * Hand-rolled because no media-query hook is installed in apps/platform
 * — adding a dependency just for this would be over-scoped.
 */
export function useIsBelow(px: number): boolean | null {
  return useMediaQuery(`(max-width: ${px - 1}px)`);
}
