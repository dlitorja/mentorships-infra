"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  saveGoogleCalendarSelection,
  disconnectGoogleCalendar,
} from "@/lib/queries/api-client";
import { useGoogleCalendars } from "@/lib/queries/use-google-calendar";

function isOAuthCallback(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.get("google_calendar") === "connected";
}

/**
 * Card component for connecting and configuring Google Calendar integration.
 * Allows instructors to select which calendar to use for events
 * and which calendars to consider for availability (busy times).
 * Provides connect, disconnect, and reconnect actions.
 */
export function GoogleCalendarCard(): React.JSX.Element {
  const queryClient = useQueryClient();
  const {
    data: calendarsData,
    isLoading,
    error,
  } = useGoogleCalendars();

  const connected = calendarsData?.connected ?? false;
  const calendars = calendarsData?.calendars ?? [];

  const [eventCalendarId, setEventCalendarId] = useState<string>("primary");
  const [availabilityCalendarIds, setAvailabilityCalendarIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (calendarsData) {
      setEventCalendarId(calendarsData.selected.eventCalendarId);
      setAvailabilityCalendarIds(calendarsData.selected.availabilityCalendarIds);
    }
  }, [calendarsData]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isOAuthCallback()) return;
    const url = new URL(window.location.href);
    url.search = "";
    window.history.replaceState({}, "", url.toString());
    queryClient.invalidateQueries({ queryKey: ["googleCalendars"] });
  }, [queryClient]);

  useEffect(() => {
    if (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load calendars");
    }
  }, [error]);

  const writableCalendars = calendars.filter(
    (c) => c.accessRole === "owner" || c.accessRole === "writer"
  );

  const toggleAvailability = (id: string) => {
    setAvailabilityCalendarIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const saveSelection = async () => {
    setSaving(true);
    try {
      if (!eventCalendarId || availabilityCalendarIds.length === 0) {
        toast.error("Select event calendar and at least one availability calendar");
        return;
      }
      await saveGoogleCalendarSelection({ eventCalendarId, availabilityCalendarIds });
      toast.success("Calendar selection saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save selection");
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    setSaving(true);
    try {
      await disconnectGoogleCalendar();
      queryClient.invalidateQueries({ queryKey: ["googleCalendars"] });
      toast.success("Disconnected Google Calendar");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to disconnect");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card id="integrations">
      <CardHeader>
        <CardTitle>Google Calendar</CardTitle>
        <CardDescription>
          Connect your Google Calendar to manage availability and automatically create events for booked sessions.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !connected ? (
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Not connected</div>
              <div className="text-sm text-muted-foreground">Start the OAuth flow to connect your account.</div>
            </div>
            <Button asChild>
              <a href="/api/auth/google">Connect Google Calendar</a>
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <div className="text-sm font-medium mb-2">Event calendar (where sessions are created)</div>
              {writableCalendars.length === 0 ? (
                <div className="text-sm text-destructive">
                  No writable calendars found. You may need to disconnect and connect a different Google account.
                </div>
              ) : (
                <div className="space-y-2">
                  {writableCalendars.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="eventCalendar"
                        value={c.id}
                        checked={eventCalendarId === c.id}
                        onChange={() => setEventCalendarId(c.id)}
                      />
                      <span>
                        {c.summary} {c.primary ? <span className="text-muted-foreground">(Primary)</span> : null}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="text-sm font-medium mb-2">Availability calendars (consider busy times from)</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {calendars.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      value={c.id}
                      checked={availabilityCalendarIds.includes(c.id)}
                      onChange={() => toggleAvailability(c.id)}
                    />
                    <span>
                      {c.summary} {c.primary ? <span className="text-muted-foreground">(Primary)</span> : null}
                      {c.accessRole === "reader" ? (
                        <span className="ml-2 text-muted-foreground">read-only</span>
                      ) : null}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={saveSelection} disabled={saving}>
                {saving ? "Saving…" : "Save selection"}
              </Button>
              <Button variant="secondary" onClick={() => (window.location.href = "/api/auth/google")} disabled={saving}>
                Reconnect
              </Button>
              <Button variant="destructive" onClick={disconnect} disabled={saving}>
                Disconnect
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
