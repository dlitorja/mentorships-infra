import { requireRole } from "@/lib/auth-helpers";
import { UserButton } from "@clerk/nextjs";

import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { Id, Doc } from "@/convex/_generated/dataModel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Users, BookOpen, CheckCircle2 } from "lucide-react";
import { ProtectedLayout } from "@/components/navigation/protected-layout";
import Link from "next/link";
import { InstructorBookingsList } from "@/components/instructor/bookings-list";
import { GoogleCalendarAlertBanner } from "@/components/instructor/google-calendar-status";
import { UpcomingSessionCard, PastSessionCard } from "@/components/instructor/session-cards";

type UpcomingSession = {
  id: Id<"sessions">;
  scheduledAt: number;
  status: string;
  studentEmail: string | null;
  remainingSessions: number | null;
};

type PastSession = {
  id: Id<"sessions">;
  scheduledAt: number;
  completedAt: number | null;
  canceledAt: number | null;
  status: string;
  studentEmail: string | null;
  notes: string | null;
};

type SeatReservation = Doc<"seatReservations">;

/**
 * Format a date for display in the dashboard.
 * @param date - The date to format (can be Date, string, number, or null)
 * @returns A formatted date string like "Jun 1, 2026" or "N/A" if null
 */
function formatDate(date: Date | string | null | number): string {
  if (!date) return "N/A";
  const d = typeof date === "number" ? new Date(date) : (typeof date === "string" ? new Date(date) : date);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Format a date and time for display in the dashboard.
 * @param date - The date to format (can be Date, string, or number from Unix timestamp)
 * @returns A formatted date-time string like "Jun 1, 2026 at 2:30 PM"
 */
function formatDateTime(date: Date | string | number): string {
  const d = typeof date === "number" ? new Date(date) : (typeof date === "string" ? new Date(date) : date);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Instructor dashboard page displaying active students, upcoming sessions,
 * available seats, and Google Calendar connection status.
 * Fetches real-time data from Convex including active seat reservations,
 * upcoming sessions, and instructor profile information.
 */
export default async function InstructorDashboardPage() {
  const user = await requireRole("instructor");
  const convex = getConvexClient();
  const instructorRecord = await convex.query(api.instructors.getInstructorByUserId, { userId: user.id });

  if (!instructorRecord) {
    return (
      <ProtectedLayout currentPath="/instructor/dashboard">
        <div className="container mx-auto p-4 md:p-8">
          <Card>
            <CardContent className="pt-6">
              <p className="text-center text-muted-foreground">
                Instructor profile not found. Please contact support.
              </p>
            </CardContent>
          </Card>
        </div>
      </ProtectedLayout>
    );
  }

  // Using Convex for all instructor data
  // Session data comes from Convex queries
  let upcomingSessions: UpcomingSession[] = [];
  let pastSessions: PastSession[] = [];
  let activeSeatsData: SeatReservation[] = [];
  let maxSeats = 0;
  let activeStudentsCount = 0;

  if (instructorRecord?._id) {
    try {
      // Get active seats and calculate unique students
      activeSeatsData = await convex.query(api.seatReservations.getInstructorActiveSeats, { instructorId: instructorRecord._id as Id<"instructors"> });
      const uniqueStudentIds = new Set(activeSeatsData.map((seat) => seat.userId));
      activeStudentsCount = uniqueStudentIds.size;

      // Calculate max seats from instructor inventory
      const oneOnOne = (instructorRecord as Doc<"instructors">)?.oneOnOneInventory ?? 0;
      const group = (instructorRecord as Doc<"instructors">)?.groupInventory ?? 0;
      maxSeats = oneOnOne + group;

      // Get upcoming sessions with student info
      const sessionsResult = await convex.query(api.sessions.getInstructorUpcomingSessions, { instructorId: instructorRecord._id as Id<"instructors">, limit: 5 });
      upcomingSessions = sessionsResult as UpcomingSession[];

      // Get past sessions with student info
      const pastSessionsResult = await convex.query(api.sessions.getInstructorPastSessions, { instructorId: instructorRecord._id as Id<"instructors">, limit: 5 });
      pastSessions = pastSessionsResult as PastSession[];
    } catch (e) {
      console.error("Failed to load instructor dashboard stats", e);
    }
  }

  const remainingSeats = Math.max(0, maxSeats - activeSeatsData.length);

  // Bookings created via Google Calendar integration
  let bookings: Array<{ id: string; startUtc: number; endUtc: number; studentEmail: string; status: string }> = [];
  if (instructorRecord?._id) {
    try {
      bookings = await convex.query(api.bookings.listInstructorBookings, { instructorId: instructorRecord._id as any, limit: 10 });
    } catch (e) {
      console.error("Failed to load instructor bookings", e);
    }
}

  return (
    <ProtectedLayout currentPath="/instructor/dashboard">
      <div className="container mx-auto p-4 md:p-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">Instructor Dashboard</h1>
            <p className="text-muted-foreground mt-1">
              Welcome back, Instructor
            </p>
          </div>
          <UserButton />
        </div>

        <GoogleCalendarAlertBanner
          isCalendarConnected={!!(instructorRecord as any)?.googleRefreshToken}
          hasTimeZone={!!instructorRecord.timeZone}
          hasWorkingHours={!!instructorRecord.workingHours && Object.keys(instructorRecord.workingHours).length > 0}
        />

        {/* Stats Overview */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Active Students
              </CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {activeStudentsCount}
              </div>
              <p className="text-xs text-muted-foreground">
                of {maxSeats} seats filled
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Upcoming Sessions
              </CardTitle>
              <Calendar className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{upcomingSessions.length}</div>
              <p className="text-xs text-muted-foreground">
                {upcomingSessions.length === 1 ? "session" : "sessions"} scheduled
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Available Seats</CardTitle>
              <BookOpen className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {remainingSeats}
              </div>
              <p className="text-xs text-muted-foreground">
                {remainingSeats === 1
                  ? "seat"
                  : "seats"}{" "}
                available
              </p>
            </CardContent>
          </Card>
        </div>

<div className="grid gap-6 md:grid-cols-2">
          {/* Calendar Bookings */}
          <Card>
            <CardHeader>
              <CardTitle>Calendar Bookings</CardTitle>
              <CardDescription>Bookings created via Google Calendar</CardDescription>
            </CardHeader>
            <CardContent>
              <InstructorBookingsList initial={bookings} />
            </CardContent>
          </Card>
          
          {/* Upcoming Sessions */}
          <Card>
            <CardHeader>
              <CardTitle>Upcoming Sessions</CardTitle>
              <CardDescription>
                Your scheduled mentorship sessions
              </CardDescription>
            </CardHeader>
            <CardContent>
              {upcomingSessions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="mb-2">No upcoming sessions</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {upcomingSessions.map((session) => (
                    <UpcomingSessionCard key={session.id} session={session} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Sessions */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Sessions</CardTitle>
              <CardDescription>Your completed mentorship sessions</CardDescription>
            </CardHeader>
            <CardContent>
              {pastSessions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckCircle2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No completed sessions yet</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {pastSessions.map((session) => (
                    <PastSessionCard key={session.id} session={session} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Active Students */}
        {activeSeatsData.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Active Students</CardTitle>
              <CardDescription>
                Students with active session packs ({activeSeatsData.length} of {maxSeats})
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {activeSeatsData.map((seat) => (
                  <div
                    key={seat._id}
                    className="border rounded-lg p-4 space-y-2"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold">Student ID: {seat.userId}</p>
                        <p className="text-sm text-muted-foreground">
                          Seat expires {formatDate(new Date(seat.seatExpiresAt))}
                        </p>
                        {seat.gracePeriodEndsAt && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Grace period ends {formatDate(new Date(seat.gracePeriodEndsAt))}
                          </p>
                        )}
                      </div>
                      <Badge
                        variant={
                          seat.status === "active"
                            ? "default"
                            : seat.status === "grace"
                            ? "secondary"
                            : "outline"
                        }
                      >
                        {seat.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              <Link
                href="/instructor/sessions"
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                View All Sessions
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </ProtectedLayout>
  );
}
