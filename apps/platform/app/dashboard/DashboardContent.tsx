"use client";

import { useUser } from "@clerk/nextjs";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, User, BookOpen, CheckCircle2, Loader2 } from "lucide-react";
import { useActiveSessionPacksByUser, useUserTotalRemainingSessions } from "@/lib/queries/convex/use-session-packs";
import { useUpcomingStudentSessions } from "@/lib/queries/convex/use-sessions";
import { useInstructor, useInstructorByUserId } from "@/lib/queries/convex/use-instructors";
import { useMemo, useEffect, useState, useRef } from "react";
import { Id } from "@/convex/_generated/dataModel";

function formatDate(date: number): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(date: number): string {
  return new Date(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

import { GOOGLE_CALENDAR_NOT_CONNECTED_CACHE_KEY } from "@/lib/constants/storage-keys";

function isOAuthCallback(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.get("oauth_success") === "true" || params.get("connected") === "true";
}

interface SessionPackData {
  _id: Id<"sessionPacks">;
  instructorId: string;
  totalSessions: number;
  remainingSessions: number;
  expiresAt?: number;
  purchasedAt: number;
  mentorshipType?: string;
}

interface SessionData {
  _id: Id<"sessions">;
  instructorId: string;
  sessionPackId: string;
  scheduledAt: number;
  status: string;
}

function InstructorBadge({ instructorId }: { instructorId: string }) {
  const { data: instructor, isLoading } = useInstructor(instructorId);
  if (isLoading || !instructor) return null;
  return (
    <div>
      <span className="font-medium">{instructor.name}</span>
      {instructor.bio && (
        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
          {instructor.bio}
        </p>
      )}
    </div>
  );
}

function SessionPackCard({ pack }: { pack: SessionPackData }) {
  return (
    <div className="border rounded-lg p-4 space-y-2">
      <div className="flex items-start justify-between">
        <div>
          <InstructorBadge instructorId={pack.instructorId} />
        </div>
        <Badge variant="secondary">
          {pack.remainingSessions} left
        </Badge>
      </div>
      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-1">
          <Calendar className="h-4 w-4" />
          <span>
            {pack.expiresAt
              ? `Expires ${formatDate(pack.expiresAt)}`
              : "No expiration"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Clock className="h-4 w-4" />
          <span>
            {pack.totalSessions - pack.remainingSessions}/
            {pack.totalSessions} used
          </span>
        </div>
      </div>
      {pack.mentorshipType && (
        <div className="pt-2">
          <Link
            href={`/workspace/${pack._id}`}
            className="text-sm text-primary hover:underline"
          >
            Open workspace →
          </Link>
        </div>
      )}
    </div>
  );
}

function UpcomingSessionCard({ session }: { session: SessionData }) {
  return (
    <div className="border rounded-lg p-4 space-y-2">
      <div className="flex items-start justify-between">
        <div>
          <InstructorBadge instructorId={session.instructorId} />
          <p className="text-sm text-muted-foreground">
            {formatDateTime(session.scheduledAt)}
          </p>
        </div>
        <Badge variant="outline">Scheduled</Badge>
      </div>
      <div className="pt-2">
        <Link
          href={`/workspace/${session.sessionPackId}`}
          className="text-sm text-primary hover:underline"
        >
          Open workspace →
        </Link>
      </div>
    </div>
  );
}

export function DashboardContent() {
  const { user, isLoaded } = useUser();
  const userId = user?.id;

  const { data: instructorRecord } = useInstructorByUserId(userId || "");
  const isInstructorOrAdmin = Boolean(instructorRecord);

  type GoogleBookingStatus = "pending" | "confirmed" | "canceled" | "completed";
  type GoogleBooking = { id: string; startUtc: number; endUtc: number; status: GoogleBookingStatus };
  const [googleBookings, setGoogleBookings] = useState<GoogleBooking[]>([]);
  const [loadingGoogleBookings, setLoadingGoogleBookings] = useState(false);
  const [googleCalendarConnected, setGoogleCalendarConnected] = useState(false);
  const [loadingGoogleCalendar, setLoadingGoogleCalendar] = useState(true);

  const discordConnected = Boolean(
    user?.externalAccounts?.some((a) => a.provider?.toLowerCase?.().includes("discord"))
  );

  const { data: sessionPacks, isLoading: packsLoading } = useActiveSessionPacksByUser(userId || "");
  const { data: totalSessions } = useUserTotalRemainingSessions(userId || "");
  const { data: upcomingSessions, isLoading: sessionsLoading } = useUpcomingStudentSessions(userId || "");

  useEffect(() => {
    if (!isLoaded || !userId) {
      setGoogleBookings([]);
      setLoadingGoogleBookings(false);
      return;
    }
    let cancelled = false;
    async function load() {
      setLoadingGoogleBookings(true);
      try {
        const res = await fetch("/api/bookings/me");
        const json = await res.json().catch(() => ({}));
        if (!cancelled) {
          if (res.ok && json?.success) {
            setGoogleBookings(json.bookings || []);
          } else {
            setGoogleBookings([]);
          }
        }
      } catch {
        if (!cancelled) setGoogleBookings([]);
      }
      if (!cancelled) setLoadingGoogleBookings(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, userId]);

  useEffect(() => {
    if (!isLoaded || !userId) {
      setGoogleCalendarConnected(false);
      setLoadingGoogleCalendar(false);
      return;
    }
    if (!isInstructorOrAdmin) {
      setGoogleCalendarConnected(false);
      setLoadingGoogleCalendar(false);
      return;
    }
    if (typeof window !== "undefined") {
      if (isOAuthCallback()) {
        sessionStorage.removeItem(GOOGLE_CALENDAR_NOT_CONNECTED_CACHE_KEY);
        const url = new URL(window.location.href);
        url.search = "";
        window.history.replaceState({}, "", url.toString());
      }
      if (sessionStorage.getItem(GOOGLE_CALENDAR_NOT_CONNECTED_CACHE_KEY) === "true") {
        setGoogleCalendarConnected(false);
        setLoadingGoogleCalendar(false);
        return;
      }
    }
    let cancelled = false;
    async function loadGoogleStatus(): Promise<void> {
      setLoadingGoogleCalendar(true);
      try {
        const res = await fetch("/api/google/calendars");
        if (!cancelled) {
          if (res.status === 409) {
            setGoogleCalendarConnected(false);
            sessionStorage.setItem(GOOGLE_CALENDAR_NOT_CONNECTED_CACHE_KEY, "true");
          } else {
            setGoogleCalendarConnected(res.ok);
            if (res.ok) {
              sessionStorage.removeItem(GOOGLE_CALENDAR_NOT_CONNECTED_CACHE_KEY);
            }
          }
        }
      } catch {
        if (!cancelled) setGoogleCalendarConnected(false);
      }
      if (!cancelled) setLoadingGoogleCalendar(false);
    }
    loadGoogleStatus();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, userId, isInstructorOrAdmin]);

  const discordSyncRef = useRef(false);

  useEffect(() => {
    if (!isLoaded || !userId) return;
    if (isInstructorOrAdmin) return;
    if (!discordConnected) return;
    if (discordSyncRef.current) return;
    discordSyncRef.current = true;
    fetch("/api/user/discord/sync-role", { method: "POST" }).catch(() => {
    });
  }, [isLoaded, userId, isInstructorOrAdmin, discordConnected]);

  const sortedPacks = useMemo(() => {
    if (!sessionPacks) return [];
    return [...sessionPacks].sort((a, b) => b.purchasedAt - a.purchasedAt);
  }, [sessionPacks]);

  const uniqueInstructorCount = useMemo(() => {
    if (!sessionPacks) return 0;
    const uniqueIds = new Set(sessionPacks.map((p) => p.instructorId));
    return uniqueIds.size;
  }, [sessionPacks]);

  if (!isLoaded) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Welcome back, {user.primaryEmailAddress?.emailAddress}
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Remaining Sessions
            </CardTitle>
            <BookOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalSessions ?? 0}</div>
            <p className="text-xs text-muted-foreground">
              {(totalSessions ?? 0) === 1 ? "session" : "sessions"} available
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Packs</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{sortedPacks.length}</div>
            <p className="text-xs text-muted-foreground">
              {sortedPacks.length === 1 ? "pack" : "packs"} active
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Instructors</CardTitle>
            <User className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{uniqueInstructorCount}</div>
            <p className="text-xs text-muted-foreground">
              {uniqueInstructorCount === 1 ? "instructor" : "instructors"} assigned
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Get started with your mentorship</CardTitle>
          <CardDescription>
            Complete these steps to make the most of your sessions.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!discordConnected && (
            <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/50">
              <div className="flex-1">
                <div className="font-medium flex items-center gap-2">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
                  Connect Discord
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Join the community and access your mentorship channels.
                </p>
              </div>
              <Link
                href="/settings"
                className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 shrink-0"
              >
                Connect
              </Link>
            </div>
          )}

          {!googleCalendarConnected && !loadingGoogleCalendar && isInstructorOrAdmin && (
            <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/50">
              <div className="flex-1">
                <div className="font-medium flex items-center gap-2">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zM9 14H7v-2h2v2zm4 0h-2v-2h2v2zm4 0h-2v-2h2v2zm-8 4H7v-2h2v2zm4 0h-2v-2h2v2zm4 0h-2v-2h2v2z"/></svg>
                  Connect Google Calendar
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Enable calendar sync to schedule and manage sessions automatically.
                </p>
              </div>
              <Link
                href="/settings"
                className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 shrink-0"
              >
                Connect
              </Link>
            </div>
          )}

          {(totalSessions ?? 0) > 0 && (
            <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/50">
              <div className="flex-1">
                <div className="font-medium flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  Book a session
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  You have {(totalSessions ?? 0) === 1 ? "1 session" : `${totalSessions} sessions`} available. Schedule your first session with your instructor.
                </p>
              </div>
              <Link
                href="/instructors"
                className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 shrink-0"
              >
                Book now
              </Link>
            </div>
          )}

          {discordConnected && (!isInstructorOrAdmin || googleCalendarConnected) && (totalSessions ?? 0) === 0 && sortedPacks.length === 0 && (
            <div className="text-center py-4 text-muted-foreground">
              <p>You&apos;re all set! Browse instructors to get started.</p>
              <Link className="text-primary hover:underline mt-2 inline-block" href="/instructors">
                Browse instructors →
              </Link>
            </div>
          )}

          {sortedPacks.length > 0 && (
            <div className="pt-2 border-t">
              <Link
                href="/instructors"
                className="text-sm text-primary hover:underline"
              >
                Browse more instructors →
              </Link>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Active Session Packs</CardTitle>
            <CardDescription>
              Your current mentorship packs and remaining sessions
            </CardDescription>
          </CardHeader>
          <CardContent>
            {packsLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : sortedPacks.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <BookOpen className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="mb-2">No active session packs</p>
                <Link
                  href="/instructors"
                  className="text-primary hover:underline"
                >
                  Browse instructors →
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {sortedPacks.map((pack) => (
                  <SessionPackCard key={pack._id} pack={pack as SessionPackData} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Upcoming Sessions</CardTitle>
            <CardDescription>
              <div className="space-y-2">
                <p>Your scheduled mentorship sessions</p>
                <div className="text-xs flex items-start gap-2 rounded-md border p-2 bg-muted/50">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mt-0.5 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg>
                  <p>
                    To cancel or reschedule, contact your instructor in your workspace. Please try to inform them at least 24 hours in advance; instructors handle changes requested with less than 24 hours&apos; notice at their discretion.
                  </p>
                </div>
              </div>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sessionsLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : !upcomingSessions || upcomingSessions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="mb-2">No upcoming sessions</p>
                <Link
                  href="/instructors"
                  className="text-primary hover:underline"
                >
                  Schedule a session →
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {upcomingSessions.map((session) => (
                  <UpcomingSessionCard key={session._id} session={session as SessionData} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Calendar Bookings</CardTitle>
            <CardDescription>
              <div className="space-y-2">
                <p>Bookings created via Google Calendar</p>
                <div className="text-xs flex items-start gap-2 rounded-md border p-2 bg-muted/50">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mt-0.5 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg>
                  <p>
                    Need to cancel or reschedule? Contact your instructor in your workspace. Please try to inform them at least 24 hours in advance; instructors handle changes requested with less than 24 hours&apos; notice at their discretion.
                  </p>
                </div>
              </div>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingGoogleBookings ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : googleBookings.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No bookings yet</p>
              </div>
            ) : (
              <div className="space-y-4">
                {googleBookings.map((b) => {
                  const awaiting = b.status === "confirmed" && b.startUtc < Date.now();
                  return (
                    <div key={b.id} className="border rounded-lg p-4 flex items-center justify-between">
                      <div>
                        <p className="font-medium">{new Date(b.startUtc).toLocaleString()}</p>
                        {awaiting ? (
                          <p className="text-xs text-muted-foreground mt-1">Awaiting instructor confirmation</p>
                        ) : null}
                      </div>
                      <Badge variant={b.status === "completed" ? "default" : b.status === "canceled" ? "destructive" : "outline"}>
                        {b.status}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <Link
              href="/instructors"
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Browse Instructors
            </Link>
            {(totalSessions ?? 0) > 0 && (
              <Link
                href="/instructors"
                className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
              >
                Schedule Session
              </Link>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}