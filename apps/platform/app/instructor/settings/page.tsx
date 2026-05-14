import { requireRole } from "@/lib/auth-helpers";
import { ProtectedLayout } from "@/components/navigation/protected-layout";
import { SchedulingSettingsForm } from "@/components/instructor/scheduling-settings-form";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";

export default async function InstructorSettingsPage() {
  const user = await requireRole("instructor");
  const convex = getConvexClient();
  const instructorRecord = await convex.query(api.instructors.getInstructorByUserId, { userId: user.id });

  if (!instructorRecord) {
    return (
      <ProtectedLayout currentPath="/instructor/settings">
        <div className="container mx-auto p-4 md:p-8">
          <p className="text-muted-foreground">Instructor profile not found.</p>
        </div>
      </ProtectedLayout>
    );
  }

  return (
    <ProtectedLayout currentPath="/instructor/settings">
      <div className="container mx-auto p-4 md:p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Instructor Settings</h1>
          <p className="text-muted-foreground">
            Configure availability rules for bookings.
          </p>
        </div>

        <SchedulingSettingsForm
          initialTimeZone={instructorRecord.timeZone ?? null}
          initialWorkingHours={instructorRecord.workingHours ?? null}
        />
      </div>
    </ProtectedLayout>
  );
}