import { requireRole } from "@/lib/auth-helpers";
import { getMentorByUserId } from "@mentorships/db";
import { ProtectedLayout } from "@/components/navigation/protected-layout";
import { SchedulingSettingsForm } from "@/components/instructor/scheduling-settings-form";
import type { MentorWorkingHours } from "@mentorships/db";

export default async function InstructorSettingsPage() {
  const user = await requireRole("mentor");
  const mentor = await getMentorByUserId(user.id);

  if (!mentor) {
    return (
      <ProtectedLayout currentPath="/instructor/settings">
        <div className="container mx-auto p-4 md:p-8">
          <p className="text-muted-foreground">Mentor profile not found.</p>
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
          initialTimeZone={mentor.timeZone ?? null}
          initialWorkingHours={(mentor.workingHours as MentorWorkingHours | null) ?? null}
        />
      </div>
    </ProtectedLayout>
  );
}

