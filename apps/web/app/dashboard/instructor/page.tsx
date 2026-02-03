import { redirect } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { getMentorByUserId, getMentorMenteesWithSessionInfo, requireDbUser } from "@mentorships/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, Calendar, Clock, Plus, Minus } from "lucide-react";
import { MenteeSessionControls } from "./_components/mentee-session-controls";

function formatDate(date: Date | string | null): string {
  if (!date) return "N/A";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export const dynamic = "force-dynamic";

export default async function InstructorDashboardPage() {
  const dbUser = await requireDbUser();

  const mentor = await getMentorByUserId(dbUser.id);
  if (!mentor) {
    redirect("/dashboard?error=not_instructor");
  }

  const mentees = await getMentorMenteesWithSessionInfo(mentor.id);

  const totalMentees = mentees.length;
  const totalSessionsRemaining = mentees.reduce((sum, m) => sum + m.remainingSessions, 0);
  const totalSessionsCompleted = mentees.reduce((sum, m) => sum + m.completedSessionCount, 0);

  return (
    <div className="container mx-auto p-4 md:p-8 space-y-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Instructor Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Manage your mentees and sessions
          </p>
        </div>
        <UserButton />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Mentees</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalMentees}</div>
            <p className="text-xs text-muted-foreground">
              {totalMentees === 1 ? "mentee" : "mentees"} assigned
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sessions Remaining</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalSessionsRemaining}</div>
            <p className="text-xs text-muted-foreground">
              across all mentees
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sessions Completed</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalSessionsCompleted}</div>
            <p className="text-xs text-muted-foreground">
              total completed
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your Mentees</CardTitle>
          <CardDescription>
            Manage session counts and view session history for each mentee
          </CardDescription>
        </CardHeader>
        <CardContent>
          {mentees.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="mb-2">No mentees assigned yet</p>
              <p className="text-sm">
                Contact an admin to assign mentees to your instruction.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {mentees.map((mentee) => (
                <div
                  key={mentee.sessionPackId}
                  className="border rounded-lg p-4 space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold">{mentee.email}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant={mentee.status === "active" ? "default" : "secondary"}>
                          {mentee.status}
                        </Badge>
                        {mentee.remainingSessions <= 1 && (
                          <Badge variant="destructive">Low sessions</Badge>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold">{mentee.remainingSessions}</p>
                      <p className="text-xs text-muted-foreground">sessions left</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-6 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Clock className="h-4 w-4" />
                      <span>
                        {mentee.completedSessionCount}/{mentee.totalSessions} used
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Calendar className="h-4 w-4" />
                      <span>Last session: {formatDate(mentee.lastSessionCompletedAt)}</span>
                    </div>
                  </div>

                  <MenteeSessionControls
                    sessionPackId={mentee.sessionPackId}
                    currentRemaining={mentee.remainingSessions}
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
