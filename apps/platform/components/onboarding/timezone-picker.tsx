"use client";

import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useConvexMutation } from "@convex-dev/react-query";
import { Globe2, Loader2, Check } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * PR 14 — Student timezone picker.
 *
 * Auto-detects the user's timezone on first mount via
 * `Intl.DateTimeFormat().resolvedOptions().timeZone` (the browser
 * surfaces the OS / locale set zone — no permission prompt
 * required; accurate when the system clock is set correctly).
 * The dropdown lets the student override their choice. The
 * picked value is persisted via the `setStudentTimezone`
 * Convex mutation which only the assigned student can call.
 *
 * Why no geolocation permission: `Intl.DateTimeFormat()` covers
 * ~95% of users. A geolocation-prompt would force a permission
 * dialog the user might decline, and the OS-set zone is almost
 * always right. If we ever need better accuracy for the rare
 * traveler / VPN case, layering `navigator.geolocation` over
 * the top of this is straightforward — the picker already
 * surfaces a "we chose `Detected`" hint you can swap to one
 * filled from another source.
 *
 * Grouping: the union of `Intl.supportedValuesOf('timeZone')`
 * (the canonical IANA list maintained by the host ICU) is huge
 * (~600 entries). We group by leading-path prefix
 * (Americas/, Europe/, Asia/, etc.) so the dropdown stays
 * scannable. Anything outside the well-known buckets goes into
 * "Other".
 */

interface TimezonePickerProps {
  onboardingId: Id<"adminOnboardings">;
  /** Pre-detected zone from the server (passes through unchanged). */
  initialTimezone: string | null | undefined;
}

/**
 * Returns the auto-detected IANA zone, or `null` when the
 * runtime doesn't expose `Intl.DateTimeFormat()` (older
 * browsers, exotic test harnesses). Caller treats `null` as
 * "show the detected but unverified behaviour — defer to the
 * dropdown".
 */
function detectClientTimezone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof zone === "string" && zone.length > 0 && zone.length <= 64) {
      return zone;
    }
  } catch {
    // Some test environments polyfill Intl weirdly; fall through
    // to the dropdown default.
  }
  return null;
}

/**
 * Group IANA zones by their first path segment. `America/New_York`
 * → "Americas", `Europe/Paris` → "Europe", `UTC` → "UTC".
 *
 * Buckets are sorted alphabetically; zones within each bucket
 * are also sorted alphabetically by their full IANA name.
 */
function buildZoneGroups(): Array<{ group: string; zones: string[] }> {
  const zones =
    typeof Intl.supportedValuesOf === "function"
      ? (() => {
          try {
            return Intl.supportedValuesOf("timeZone");
          } catch {
            return [];
          }
        })()
      : [];
  const buckets = new Map<string, string[]>();
  for (const zone of zones) {
    const slash = zone.indexOf("/");
    const group = slash === -1 ? "Other" : zone.slice(0, slash);
    const list = buckets.get(group) ?? [];
    list.push(zone);
    buckets.set(group, list);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, list]) => ({
      group,
      zones: list.sort((a, b) => a.localeCompare(b)),
    }));
}

/**
 * Look up a friendly UTC-offset label for an IANA zone. We use
 * the host's `Intl.DateTimeFormat` (with a stand-in `en-US`
 * locale for cross-runtime stability) and read the resolved
 * timeZoneName so the dropdown can show e.g. "GMT-05:00".
 */
function formatOffset(zone: string, now: Date): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "shortOffset",
    }).formatToParts(now);
    const offset = parts.find((p) => p.type === "timeZoneName")?.value;
    return offset ?? "";
  } catch {
    return "";
  }
}

/**
 * Special-case the `UTC` zone so its offset stays "UTC" rather
 * than rendering as "GMT+00:00" (cosmetic — easier to scan a
 * dropdown when "UTC" reads as "UTC").
 */
function friendlyOffsetLabel(zone: string, now: Date): string {
  if (zone === "UTC") return "UTC";
  return formatOffset(zone, now);
}

export function TimezonePicker({
  onboardingId,
  initialTimezone,
}: TimezonePickerProps) {
  const selectId = useId();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [detected, setDetected] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(
    initialTimezone ?? null
  );
  const [savedAs, setSavedAs] = useState<string | null>(initialTimezone ?? null);
  const [savingState, setSavingState] = useState<"idle" | "saving" | "saved">(
    "saved"
  );
  const lastSavedRef = useRef<string | null>(initialTimezone ?? null);

  // Auto-detect on first mount.
  useEffect(() => {
    setDetected(detectClientTimezone());
  }, []);

  // Build zone groups once per mount; the IANA list is static
  // for the lifetime of the page.
  const groups = useMemo(() => buildZoneGroups(), []);
  const now = useMemo(() => new Date(), []);

  /**
   * Persist via the public Convex mutation. The mutation has
   * its own auth + validation (only the assigned student can
   * write; the value is checked against `Intl.DateTimeFormat`),
   * so we don't need a verification gate on the client side.
   */
  const setTimezone = useConvexMutation(api.adminOnboarding.setStudentTimezone);
  const persist = useMutation({
    mutationFn: (zone: string | null) =>
      setTimezone({ onboardingId, timezone: zone ?? "" }),
    onSuccess: ({ studentTimezone }) => {
      setSavedAs(studentTimezone);
      setSavingState("saved");
      // Make sure any React-Query cache of `getOnboardingView`
      // is invalidated so anything reading the row sees the new
      // value on the next query.
      queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === "convex" &&
          typeof query.queryKey[1] === "string" &&
          query.queryKey[1].startsWith("adminOnboarding"),
      });
      // Trigger the server component to re-render with the
      // fresh view (the staff-side /onboarding/[id] page reads
      // it through `fetchQuery`).
      router.refresh();
    },
    onError: (err) => {
      setSavingState("idle");
      toast.error("Couldn't save your timezone", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    },
  });

  /**
   * Greptile P2 #3 — auto-save the detected zone on first mount
   * when the row has no `studentTimezone` yet. Without this,
   * a student who accepts the dropdown's default by clicking
   * through the questionnaire without ever touching the picker
   * leaves the field `undefined`. Saving on mount is intrusive
   * but cheap (one mutation per student per session) and lets
   * us skip an explicit "Save" button entirely.
   *
   * Bails out when the detected zone is missing (older
   * browsers, weird test harnesses) so the user isn't
   * auto-pinned to a junk value by a polyfill.
   */
  useEffect(() => {
    if (initialTimezone) return;
    if (typeof Intl === "undefined") return;
    let detected: string | null = null;
    try {
      detected = detectClientTimezone();
    } catch {
      return;
    }
    if (!detected) return;
    if (lastSavedRef.current === detected) return;
    setChosen(detected);
    setSavingState("saving");
    persist.mutate(detected, {
      onSuccess: () => {
        lastSavedRef.current = detected;
      },
    });
    // persist.mutate is stable enough we don't need to add it
    // to the deps array; the effect only runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Stable debounce so a fast dropdown scrub doesn't queue a
   * queue of mutations. 400ms is short enough to feel
   * instant but long enough to absorb the typical "click
   * through three options before settling" interaction.
   */
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onPick = useCallback(
    (next: string | null) => {
      setChosen(next);
      setSavingState("saving");
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        // Skip the round-trip when the value is already on the
        // server (returning to the dropdown after navigating
        // back, or selecting the same zone the row is already
        // pinned to). Cuts redundant `setStudentTimezone`
        // write-budget writes.
        if (lastSavedRef.current === (next ?? "")) {
          setSavingState("saved");
          return;
        }
        // Greptile P2 #4 — only update lastSavedRef AFTER a
        // successful save. Updating before the mutation fires
        // would skip retries when a transient error
        // (INTL-invalid zone, network hiccup) rejected the
        // first attempt and the user re-selects the same
        // zone within the debounce window. The onSuccess
        // callback below advances the ref explicitly.
        persist.mutate(next, {
          onSuccess: () => {
            lastSavedRef.current = next;
          },
        });
      }, 400);
    },
    [persist]
  );

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    []
  );

  // The dropdown's effective value: explicit user choice wins;
  // otherwise the auto-detected zone; otherwise "no choice".
  const effectiveValue = chosen ?? detected ?? null;

  return (
    <Card className="border-2 border-blue-200 bg-blue-50/40 dark:border-blue-800 dark:bg-blue-950/20">
      <CardHeader>
        <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300">
          <Globe2 className="h-5 w-5" aria-hidden="true" />
          <span className="text-xs font-semibold uppercase tracking-wider">
            Scheduling preferences
          </span>
        </div>
        <CardTitle className="mt-2 text-xl">Your timezone</CardTitle>
        <CardDescription>
          We&apos;ll use this when scheduling your sessions
          asynchronously. The dropdown is pre-filled with the timezone
          your browser is set to — feel free to override.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label
            htmlFor={selectId}
            className="text-sm font-medium"
          >
            Timezone
          </label>
          <Select
            value={effectiveValue ?? ""}
            onValueChange={(value) => onPick(value || null)}
          >
            <SelectTrigger id={selectId} className="w-full sm:max-w-md">
              <SelectValue placeholder="Select a timezone" />
            </SelectTrigger>
            <SelectContent className="max-h-80">
              {detected && (
                <SelectGroup>
                  <SelectLabel>Detected from your browser</SelectLabel>
                  <SelectItem value={detected}>
                    {detected}
                    {friendlyOffsetLabel(detected, now)
                      ? ` (${friendlyOffsetLabel(detected, now)})`
                      : ""}
                  </SelectItem>
                </SelectGroup>
              )}
              {groups.map((g) => (
                <SelectGroup key={g.group}>
                  <SelectLabel>{g.group}</SelectLabel>
                  {g.zones.map((zone) => (
                    <SelectItem
                      key={zone}
                      value={zone}
                    >
                      {zone}
                      {friendlyOffsetLabel(zone, now)
                        ? ` (${friendlyOffsetLabel(zone, now)})`
                        : ""}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Detected from your browser:{" "}
            {detected ? (
              <span className="font-medium text-foreground">{detected}</span>
            ) : (
              <span className="italic">unavailable — please pick one above</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          {savingState === "saving" && (
            <>
              <Loader2
                className="h-4 w-4 animate-spin text-muted-foreground"
                aria-hidden="true"
              />
              <span className="text-muted-foreground">Saving…</span>
            </>
          )}
          {savingState === "saved" && savedAs && (
            <>
              <Check
                className="h-4 w-4 text-green-600"
                aria-hidden="true"
              />
              <span className="text-muted-foreground">
                Saved as{" "}
                <span className="font-medium text-foreground">{savedAs}</span>
              </span>
            </>
          )}
          {savingState === "idle" && (
            <Badge variant="outline">Not saved</Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
