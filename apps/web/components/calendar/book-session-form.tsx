"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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

  const [booking, setBooking] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function loadSlots() {
    if (!selectedPack) return;

    setLoadingSlots(true);
    setError(null);
    setInfo(null);
    setAvailableSlots([]);

    try {
      const start = new Date();
      const end = addDays(start, 7);

      const res = await fetch(
        `/api/mentors/${selectedPack.mentorId}/availability?start=${encodeURIComponent(
          start.toISOString()
        )}&end=${encodeURIComponent(end.toISOString())}&slotMinutes=60`,
        { method: "GET" }
      );

      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409 && data?.code === "GOOGLE_CALENDAR_NOT_CONNECTED") {
          setInfo("This mentor hasn’t connected Google Calendar yet.");
          return;
        }
        setError(data?.error ?? "Failed to load availability");
        return;
      }

      const slots: string[] = data?.availableSlots ?? [];
      setAvailableSlots(slots);
      if (data?.truncated) {
        setInfo("Showing the first 500 available slots (range truncated).");
      }
      if (slots.length === 0) {
        setInfo("No available slots in the next 7 days.");
      }
    } catch {
      setError("Failed to load availability");
    } finally {
      setLoadingSlots(false);
    }
  }

  async function bookSession(scheduledAtIso: string) {
    if (!selectedPack) return;

    setBooking(true);
    setError(null);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionPackId: selectedPack.id, scheduledAt: scheduledAtIso }),
      });

      const data = await res.json();
      if (!res.ok) {
        const message = data?.error ?? "Booking failed";
        setError(message);
        return;
      }

      // Refresh page to show the newly created session in the server component list
      // Basic UX: refresh page to show the newly created session in the server component list
      window.location.reload();
    } catch {
      setError("Booking failed");
    } finally {
      setBooking(false);
    }
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

            {info && <p className="text-sm text-amber-600">{info}</p>}
            {error && <p className="text-sm text-red-600">{error}</p>}

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
                        onClick={() => bookSession(slot)}
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

