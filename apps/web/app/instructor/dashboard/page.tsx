import { requireRole } from "@/lib/auth-helpers";
import { UserButton } from "@clerk/nextjs";
import {
  getMentorByUserId,
  getMentorUpcomingSessions,
  getMentorPastSessions,
  getMentorActiveSeats,
  checkSeatAvailability,
} from "@mentorships/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, Users, BookOpen, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { ProtectedLayout } from "@/components/navigation/protected-layout";
import { Button } from "@/components/ui/button";

function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function InstructorDashboardPage() {
  const user = await requireRole("mentor");
  const mentor = await getMentorByUserId(user.id);

  if (!mentor) {
    return (
      <ProtectedLayout currentPath="/instructor/dashboard">
        <div className="container mx-auto p-4 md:p-8">
          <Card>
            <CardContent className="pt-6">
              <p className="text-center text-muted-foreground">
                Mentor profile not found. Please contact support.
              </p>
            </CardContent>
          </Card>
        </div>
      </ProtectedLayout>
    );
  }

  // Fetch all dashboard data in parallel
  const [upcomingSessions, pastSessions, activeSeats, seatAvailability] =
    await Promise.all([
      getMentorUpcomingSessions(mentor.id, 10),
      getMentorPastSessions(mentor.id, 5),
      getMentorActiveSeats(mentor.id),
      checkSeatAvailability(mentor.id),
    ]);

  return (
    <ProtectedLayout currentPath="/instructor/dashboard">
      <div className="container mx-auto p-4 md:p-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">Instructor Dashboard</h1>
            <p className="text-muted-foreground mt-1">
              Welcome back, {user.email}
            </p>
          </div>
          <UserButton />
        </div>

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
                {seatAvailability.activeSeats}
              </div>
              <p className="text-xs text-muted-foreground">
                of {seatAvailability.maxSeats} seats filled
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
                {seatAvailability.remainingSeats}
              </div>
              <p className="text-xs text-muted-foreground">
                {seatAvailability.remainingSeats === 1
                  ? "seat"
                  : "seats"}{" "}
                available
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Google Calendar Connection */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div className="space-y-1">
              <CardTitle className="text-sm font-medium">Google Calendar</CardTitle>
              <CardDescription>
                Connect your calendar so students only see times you’re actually free.
              </CardDescription>
            </div>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <div className="text-sm">
              {mentor.googleRefreshToken ? (
                <span className="text-green-600">Connected</span>
              ) : (
                <span className="text-amber-600">Not connected</span>
              )}
            </div>
            <Button asChild variant={mentor.googleRefreshToken ? "outline" : "default"}>
              <a href="/api/auth/google">
                {mentor.googleRefreshToken ? "Reconnect" : "Connect Google Calendar"}
              </a>
            </Button>
          </CardContent>
        </Card>

        <div className="grid gap-6 md:grid-cols-2">
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
                    <div
                      key={session.id}
                      className="border rounded-lg p-4 space-y-2"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-semibold">
                            {session.student.email}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {formatDateTime(session.scheduledAt)}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {session.sessionPack.remainingSessions} sessions remaining
                          </p>
                        </div>
                        <Badge variant="secondary">Scheduled</Badge>
                      </div>
                    </div>
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
                    <div
                      key={session.id}
                      className="border rounded-lg p-4 space-y-2"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-semibold">
                            {session.student.email}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {session.completedAt
                              ? `Completed ${formatDateTime(session.completedAt)}`
                              : session.status === "canceled"
                              ? `Canceled ${formatDateTime(session.canceledAt || session.scheduledAt)}`
                              : `Scheduled ${formatDateTime(session.scheduledAt)}`}
                          </p>
                        </div>
                        <Badge
                          variant={
                            session.status === "completed"
                              ? "default"
                              : session.status === "canceled"
                              ? "destructive"
                              : "outline"
                          }
                        >
                          {session.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Active Students */}
        {activeSeats.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Active Students</CardTitle>
              <CardDescription>
                Students with active session packs ({activeSeats.length} of {seatAvailability.maxSeats})
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {activeSeats.map((seat) => (
                  <div
                    key={seat.id}
                    className="border rounded-lg p-4 space-y-2"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold">Student ID: {seat.userId}</p>
                        <p className="text-sm text-muted-foreground">
                          Seat expires {formatDate(seat.seatExpiresAt)}
                        </p>
                        {seat.gracePeriodEndsAt && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Grace period ends {formatDate(seat.gracePeriodEndsAt)}
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

