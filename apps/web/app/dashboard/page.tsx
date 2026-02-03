import { getUser, requireDbUser } from "@/lib/auth";
import { UserButton } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import {
  getUserSessionPacksWithMentors,
  getUserTotalRemainingSessions,
  getUserUpcomingSessions,
  getUserRecentSessions,
} from "@mentorships/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, User, BookOpen, CheckCircle2 } from "lucide-react";
import Link from "next/link";

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

// Mark this page as dynamic since it uses headers() via requireDbUser
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  try {
    const user = await requireDbUser();
    const clerkUser = await getUser();
    const discordConnected = Boolean(
      clerkUser?.externalAccounts?.some((a) => a.provider?.toLowerCase?.().includes("discord"))
    );

    // Fetch all dashboard data in parallel
    const [sessionPacksResult, totalSessions, upcomingSessions, recentSessions] =
      await Promise.all([
        getUserSessionPacksWithMentors(user.id),
        getUserTotalRemainingSessions(user.id),
        getUserUpcomingSessions(user.id, 5),
        getUserRecentSessions(user.id, 3),
      ]);

    const sessionPacks = sessionPacksResult.items;

    // Get unique instructors
    const instructors = Array.from(
      new Map(
        sessionPacks.map((pack) => [
          pack.mentor.id,
          {
            mentorId: pack.mentor.id,
            email: pack.mentorUser.email,
            bio: pack.mentor.bio,
          },
        ])
      ).values()
    );

    return (
      <div className="container mx-auto p-4 md:p-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">Dashboard</h1>
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
                Remaining Sessions
              </CardTitle>
              <BookOpen className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalSessions}</div>
              <p className="text-xs text-muted-foreground">
                {totalSessions === 1 ? "session" : "sessions"} available
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Packs</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{sessionPacks.length}</div>
              <p className="text-xs text-muted-foreground">
                {sessionPacks.length === 1 ? "pack" : "packs"} active
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Instructors</CardTitle>
              <User className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{instructors.length}</div>
              <p className="text-xs text-muted-foreground">
                {instructors.length === 1
                  ? "instructor"
                  : "instructors"}{" "}
                assigned
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Next steps</CardTitle>
            <CardDescription>
              {discordConnected
                ? "Complete onboarding so your instructor can tailor sessions to your goals."
                : "Connect Discord, then complete onboarding so you can access mentorship channels and get the most out of your sessions."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {!discordConnected ? (
              <Link className="text-primary hover:underline" href="/settings">
                Connect Discord in Settings →
              </Link>
            ) : null}
            <Link className="text-primary hover:underline" href="/dashboard/onboarding">
              Complete onboarding →
            </Link>
          </CardContent>
        </Card>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Active Session Packs */}
          <Card>
            <CardHeader>
              <CardTitle>Active Session Packs</CardTitle>
              <CardDescription>
                Your current mentorship packs and remaining sessions
              </CardDescription>
            </CardHeader>
            <CardContent>
              {sessionPacks.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <BookOpen className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="mb-2">No active session packs</p>
                  <Link
                    href="/mentors"
                    className="text-primary hover:underline"
                  >
                    Browse instructors →
                  </Link>
                </div>
              ) : (
                <div className="space-y-4">
                  {sessionPacks.map((pack) => (
                    <div
                      key={pack.id}
                      className="border rounded-lg p-4 space-y-2"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-semibold">
                            {pack.mentorUser.email}
                          </p>
                          {pack.mentor.bio && (
                            <p className="text-sm text-muted-foreground mt-1">
                              {pack.mentor.bio}
                            </p>
                          )}
                        </div>
                        <Badge variant="secondary">
                          {pack.remainingSessions} left
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-4 w-4" />
                          <span>
                            Expires {formatDate(pack.expiresAt)}
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
                    </div>
                  ))}
                </div>
              )}
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
                  <Link
                    href="/sessions"
                    className="text-primary hover:underline"
                  >
                    Schedule a session →
                  </Link>
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
                            {session.mentorUser.email}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {formatDateTime(session.scheduledAt)}
                          </p>
                        </div>
                        <Badge variant="outline">Scheduled</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Recent Sessions */}
        {recentSessions.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Recent Sessions</CardTitle>
              <CardDescription>Your completed mentorship sessions</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {recentSessions.map((session) => (
                  <div
                    key={session.id}
                    className="border rounded-lg p-4 space-y-2"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold">
                          {session.mentorUser.email}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Completed{" "}
                          {session.completedAt &&
                            formatDateTime(session.completedAt)}
                        </p>
                      </div>
                      <Badge variant="default">Completed</Badge>
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
                href="/mentors"
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Browse Instructors
              </Link>
              {totalSessions > 0 && (
                <Link
                  href="/sessions"
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
  } catch (error) {
    // Only redirect on authentication errors from requireDbUser
    if (
      error instanceof Error &&
      error.message.includes("Unauthorized")
    ) {
    redirect("/sign-in");
    }
    // Log and re-throw other errors (DB, network, bugs)
    console.error("Dashboard error:", error);
    throw error;
  }
}
