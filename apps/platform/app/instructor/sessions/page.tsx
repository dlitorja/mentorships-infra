import { requireRole } from "@/lib/auth-helpers";
import { getConvexClient } from "@/lib/convex";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { ProtectedLayout } from "@/components/navigation/protected-layout";
import { Card, CardContent } from "@/components/ui/card";
import { SessionsListClient } from "./sessions-list-client";

type InstructorAllSession = {
  id: Id<"sessions">;
  scheduledAt: number;
  status: "scheduled" | "completed" | "canceled" | "no_show";
  notes: string | null;
  recordingUrl: string | null;
  completedAt: number | null;
  canceledAt: number | null;
  studentEmail: string | null;
  remainingSessions: number | null;
  sessionPackId: Id<"sessionPacks">;
};

export default async function InstructorSessionsPage() {
  const user = await requireRole("instructor");
  const convex = getConvexClient();

  const instructorRecord = await convex.query(api.instructors.getInstructorByUserId, { userId: user.id });

  if (!instructorRecord) {
    return (
      <ProtectedLayout currentPath="/instructor/sessions">
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

  const allSessions = await convex.query(api.sessions.getInstructorAllSessions, {
    instructorId: instructorRecord._id as Id<"instructors">,
    limit: 100,
  });

  return (
    <ProtectedLayout currentPath="/instructor/sessions">
      <div className="container mx-auto p-4 md:p-8 space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">All Sessions</h2>
          <p className="text-muted-foreground">
            View and manage all your mentorship sessions
          </p>
        </div>

        <SessionsListClient sessions={allSessions as InstructorAllSession[]} />
      </div>
    </ProtectedLayout>
  );
}
