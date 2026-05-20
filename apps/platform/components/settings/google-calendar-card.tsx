"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type Calendar = {
  id: string;
  summary: string;
  accessRole: string;
  primary: boolean;
};

type CalendarsResponse = {
  connected: boolean;
  calendars: Calendar[];
  selected: {
    eventCalendarId: string;
    availabilityCalendarIds: string[];
  };
};

export function GoogleCalendarCard(): React.JSX.Element {
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [eventCalendarId, setEventCalendarId] = useState<string>("primary");
  const [availabilityCalendarIds, setAvailabilityCalendarIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch("/api/google/calendars");
        if (res.status === 409) {
          setConnected(false);
          setCalendars([]);
          return;
        }
        if (!res.ok) throw new Error("Failed to load calendars");
        const data: CalendarsResponse = await res.json();
        if (!cancelled) {
          setConnected(true);
          setCalendars(data.calendars);
          setEventCalendarId(data.selected.eventCalendarId);
          setAvailabilityCalendarIds(data.selected.availabilityCalendarIds);
        }
      } catch (e) {
        console.error(e);
        toast.error(e instanceof Error ? e.message : "Failed to load calendars");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const writableCalendars = useMemo(
    () => calendars.filter((c) => c.accessRole === "owner" || c.accessRole === "writer"),
    [calendars]
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
      const res = await fetch("/api/google/calendars/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventCalendarId, availabilityCalendarIds }),
      });
      if (!res.ok) throw new Error("Failed to save selection");
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
      const res = await fetch("/api/auth/google/disconnect", { method: "POST" });
      if (!res.ok) throw new Error("Failed to disconnect");
      setConnected(false);
      setCalendars([]);
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
        {loading ? (
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
