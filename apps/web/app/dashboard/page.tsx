import { requireDbUser } from "@/lib/auth";
import { ProtectedLayout } from "@/components/navigation/protected-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@mentorships/db";
import { sessions, sessionPacks } from "@mentorships/db";
import { eq, and, gte, count } from "drizzle-orm";

export default async function DashboardPage() {
  const user = await requireDbUser();

  // Get statistics for dashboard
  const now = new Date();
  
  const [upcomingSessionsCount] = await db
    .select({ count: count() })
    .from(sessions)
    .innerJoin(sessionPacks, eq(sessions.sessionPackId, sessionPacks.id))
    .where(
      and(
        eq(sessions.studentId, user.id),
        eq(sessions.status, "scheduled"),
        gte(sessions.scheduledAt, now)
      )
    );

  const [activePacksCount] = await db
    .select({ count: count() })
    .from(sessionPacks)
    .where(
      and(
        eq(sessionPacks.userId, user.id),
        eq(sessionPacks.status, "active")
      )
    );

  return (
    <ProtectedLayout currentPath="/dashboard">
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-muted-foreground">
            Welcome back, {user.email}!
          </p>
        </div>

        {/* Statistics Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Upcoming Sessions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{upcomingSessionsCount?.count || 0}</div>
              <p className="text-xs text-muted-foreground">
                Sessions scheduled
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Packs</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{activePacksCount?.count || 0}</div>
              <p className="text-xs text-muted-foreground">
                Session packs available
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Role</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold capitalize">{user.role}</div>
              <p className="text-xs text-muted-foreground">
                Account type
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Common tasks and navigation</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              <a href="/sessions" className="p-4 border rounded-lg hover:bg-accent transition-colors">
                <h3 className="font-semibold">View Sessions</h3>
                <p className="text-sm text-muted-foreground">See all your mentorship sessions</p>
              </a>
              <a href="/calendar" className="p-4 border rounded-lg hover:bg-accent transition-colors">
                <h3 className="font-semibold">Calendar</h3>
                <p className="text-sm text-muted-foreground">Book and manage sessions</p>
              </a>
              <a href="/settings" className="p-4 border rounded-lg hover:bg-accent transition-colors">
                <h3 className="font-semibold">Settings</h3>
                <p className="text-sm text-muted-foreground">Manage your account</p>
              </a>
            </div>
          </CardContent>
        </Card>
      </div>
    </ProtectedLayout>
  );
}

