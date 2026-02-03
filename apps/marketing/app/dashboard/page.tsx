import { getUser, requireDbUser } from "@/lib/auth";
import { UserButton } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import {
  getUserInstructorsWithSessionInfo,
  getUserLowSessionPacks,
  getUserTotalRemainingSessions,
} from "@mentorships/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, User, BookOpen, AlertTriangle } from "lucide-react";
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

function getLowSessionWarning(instructorEmail: string, sessionsRemaining: number): string {
  if (sessionsRemaining === 1) {
    return `You have only 1 session remaining with ${instructorEmail}. If you plan to continue your mentorship, please consider renewing soon. Not renewing means your mentorship slot may become available to other prospective mentees.`;
  }
  return "";
}

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  try {
    const user = await requireDbUser();
    const clerkUser = await getUser();
    const discordConnected = Boolean(
      clerkUser?.externalAccounts?.some((a) => a.provider && typeof a.provider === 'string' && a.provider.toLowerCase().includes("discord"))
    );

    const [instructorsWithSessions, lowSessionPacks, totalSessions] = await Promise.all([
      getUserInstructorsWithSessionInfo(user.id),
      getUserLowSessionPacks(user.id),
      getUserTotalRemainingSessions(user.id),
    ]);

    const instructors = instructorsWithSessions;

    return (
      <div className="container mx-auto p-4 md:p-8 space-y-6">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">My Dashboard</h1>
            <p className="text-muted-foreground mt-1">
              Welcome back, {user.email}
            </p>
          </div>
          <UserButton afterSignOutUrl="/" />
        </div>

        {lowSessionPacks.length > 0 && (
          <Card className="border-amber-200 bg-amber-50">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-amber-800">
                <AlertTriangle className="h-5 w-5" />
                Session Renewal Reminder
              </CardTitle>
              <CardDescription className="text-amber-700">
                You have sessions that need attention. Please review the details below.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {lowSessionPacks.map((pack) => (
                <div
                  key={pack.sessionPackId}
                  className="bg-white rounded-lg p-4 border border-amber-200"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-amber-900">
                        Only 1 session remaining with {pack.instructorEmail}
                      </p>
                      <p className="text-sm text-amber-700 mt-1">
                        {getLowSessionWarning(pack.instructorEmail, pack.remainingSessions)}
                      </p>
                      <p className="text-xs text-amber-600 mt-2">
                        Pack expires: {formatDate(pack.expiresAt)}
                      </p>
                    </div>
                    <Badge variant="warning" className="bg-amber-200 text-amber-800">
                      1 Session Left
                    </Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

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
              <CardTitle className="text-sm font-medium">Active Instructors</CardTitle>
              <User className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{instructors.length}</div>
              <p className="text-xs text-muted-foreground">
                {instructors.length === 1 ? "instructor" : "instructors"}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Low Session Alerts</CardTitle>
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{lowSessionPacks.length}</div>
              <p className="text-xs text-muted-foreground">
                {lowSessionPacks.length === 1 ? "instructor" : "instructors"} with 1 session
              </p>
            </CardContent>
          </Card>
        </div>

        {!discordConnected && (
          <Card>
            <CardHeader>
              <CardTitle>Connect Your Discord</CardTitle>
              <CardDescription>
                Connect Discord to access mentorship channels and receive session notifications.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                href="/settings"
                className="text-primary hover:underline"
              >
                Connect Discord in Settings →
              </Link>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>My Instructors</CardTitle>
            <CardDescription>
              Your current mentorship relationships and session details
            </CardDescription>
          </CardHeader>
          <CardContent>
            {instructors.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <User className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="mb-2">No active instructors</p>
                <Link
                  href="/instructors"
                  className="text-primary hover:underline"
                >
                  Browse instructors →
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {instructors.map((instructor) => (
                  <div
                    key={instructor.sessionPackId}
                    className={`border rounded-lg p-4 space-y-2 ${
                      instructor.remainingSessions === 1
                        ? "border-amber-200 bg-amber-50/50"
                        : ""
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold">{instructor.instructorEmail}</p>
                        {instructor.mentorBio && (
                          <p className="text-sm text-muted-foreground mt-1">
                            {instructor.mentorBio}
                          </p>
                        )}
                        <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Calendar className="h-4 w-4" />
                            <span>Expires {formatDate(instructor.expiresAt)}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Clock className="h-4 w-4" />
                            <span>
                              {instructor.remainingSessions}/{instructor.totalSessions} sessions
                            </span>
                          </div>
                        </div>
                        {instructor.lastSessionCompletedAt && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Last session: {formatDateTime(instructor.lastSessionCompletedAt)}
                          </p>
                        )}
                      </div>
                      <Badge
                        variant={
                          instructor.remainingSessions === 1
                            ? "warning"
                            : "secondary"
                        }
                        className={
                          instructor.remainingSessions === 1
                            ? "bg-amber-100 text-amber-800"
                            : ""
                        }
                      >
                        {instructor.remainingSessions} left
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

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
    if (
      error instanceof Error &&
      error.message.includes("Unauthorized")
    ) {
      redirect("/sign-in");
    }
    console.error("Dashboard error:", error);
    throw error;
  }
}
