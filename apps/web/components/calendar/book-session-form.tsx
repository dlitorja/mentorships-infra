"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { queryKeys } from "@/lib/queries/query-keys";
import { fetchMentorAvailability, bookSession } from "@/lib/queries/api-client";

type PackOption = {
  id: string;
  mentorId: string;
  remainingSessions: number;
  expiresAt: string | Date;
  status: string;
};

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function BookSessionForm({ packs }: { packs: PackOption[] }) {
  const eligiblePacks = useMemo(
    () => packs.filter((p) => p.status === "active" && p.remainingSessions > 0),
    [packs]
  );

  const [selectedPackId, setSelectedPackId] = useState<string>(
    eligiblePacks[0]?.id ?? ""
  );
  const selectedPack = eligiblePacks.find((p) => p.id === selectedPackId) ?? null;

  const [shouldLoadSlots, setShouldLoadSlots] = useState(false);
  const queryClient = useQueryClient();

  // Calculate date range for availability
  const dateRange = useMemo(() => {
    if (!selectedPack || !shouldLoadSlots) return null;
    const start = new Date();
    const end = addDays(start, 7);
    return { start: start.toISOString(), end: end.toISOString() };
  }, [selectedPack, shouldLoadSlots]);

  // Fetch availability
  const {
    data: availabilityData,
    isLoading: loadingSlots,
    error: availabilityError,
  } = useQuery({
    queryKey: queryKeys.mentors.availability(
      selectedPack?.mentorId || "",
      dateRange?.start || "",
      dateRange?.end || ""
    ),
    queryFn: () =>
      fetchMentorAvailability(
        selectedPack!.mentorId,
        dateRange!.start,
        dateRange!.end,
        60
      ),
    enabled: !!selectedPack && !!dateRange,
  });

  const availableSlots = availabilityData?.availableSlots ?? [];
  const error =
    availabilityError instanceof Error ? availabilityError.message : null;
  const info = useMemo(() => {
    if (availabilityData?.truncated) {
      return "Showing the first 500 available slots (range truncated).";
    }
    if (availableSlots.length === 0 && !loadingSlots && shouldLoadSlots) {
      return "No available slots in the next 7 days.";
    }
    return null;
  }, [availabilityData, availableSlots.length, loadingSlots, shouldLoadSlots]);

  // Handle availability errors
  const availabilityErrorMessage = useMemo(() => {
    if (
      availabilityError &&
      availabilityError instanceof Error &&
      ((availabilityError as Error & { code?: string }).code === "GOOGLE_CALENDAR_NOT_CONNECTED" ||
        availabilityError.message.includes("GOOGLE_CALENDAR_NOT_CONNECTED"))
    ) {
      return null; // This becomes info, not error
    }
    return error;
  }, [error, availabilityError]);

  const availabilityInfo = useMemo(() => {
    if (
      availabilityError &&
      availabilityError instanceof Error &&
      ((availabilityError as Error & { code?: string }).code === "GOOGLE_CALENDAR_NOT_CONNECTED" ||
        availabilityError.message.includes("GOOGLE_CALENDAR_NOT_CONNECTED"))
    ) {
      return "This mentor hasn't connected Google Calendar yet.";
    }
    return info;
  }, [error, info, availabilityError]);

  // Book session mutation
  const bookSessionMutation = useMutation({
    mutationFn: (scheduledAtIso: string) =>
      bookSession({ sessionPackId: selectedPack!.id, scheduledAt: scheduledAtIso }),
    onSuccess: () => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
      // Refresh page to show the newly created session in the server component list
      window.location.reload();
    },
  });

  const booking = bookSessionMutation.isPending;
  const bookingError =
    bookSessionMutation.error instanceof Error
      ? bookSessionMutation.error.message
      : null;

  function loadSlots() {
    setShouldLoadSlots(true);
  }

  function handleBookSession(scheduledAtIso: string) {
    if (!selectedPack) return;
    bookSessionMutation.mutate(scheduledAtIso);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Book a Session</CardTitle>
        <CardDescription>
          Availability is checked against the mentor’s Google Calendar before booking.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {eligiblePacks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You don’t have any active packs with remaining sessions.
          </p>
        ) : (
          <>
            <div className="space-y-2">
              <label className="text-sm font-medium">Session pack</label>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={selectedPackId}
                onChange={(e) => {
                  setSelectedPackId(e.target.value);
                  setAvailableSlots([]);
                  setError(null);
                  setInfo(null);
                }}
              >
                {eligiblePacks.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.remainingSessions} remaining (expires {new Date(p.expiresAt).toLocaleDateString()})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={!selectedPack || loadingSlots}
                onClick={loadSlots}
              >
                {loadingSlots ? "Loading…" : "Load available slots (next 7 days)"}
              </Button>
            </div>

            <div className="text-xs text-muted-foreground">
              Slots are generated in 60-minute increments.
            </div>

            {availabilityInfo && <p className="text-sm text-amber-600">{availabilityInfo}</p>}
            {availabilityErrorMessage && (
              <p className="text-sm text-red-600">{availabilityErrorMessage}</p>
            )}
            {bookingError && <p className="text-sm text-red-600">{bookingError}</p>}

            {availableSlots.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-medium">Available times</div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {availableSlots.slice(0, 60).map((slot) => {
                    const d = new Date(slot);
                    return (
                      <Button
                        key={slot}
                        type="button"
                        variant="outline"
                        disabled={booking}
                        onClick={() => handleBookSession(slot)}
                      >
                        {d.toLocaleString("en-US", {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </Button>
                    );
                  })}
                </div>
                {availableSlots.length > 60 && (
                  <p className="text-xs text-muted-foreground">
                    Showing first 60 slots. (We can add paging/filters next.)
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

