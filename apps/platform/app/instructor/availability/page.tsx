import { requireRole, getConvexAuthToken } from "@/lib/auth-helpers";
import { ProtectedLayout } from "@/components/navigation/protected-layout";
import { SchedulingSettingsForm } from "@/components/instructor/scheduling-settings-form";
import { AvailabilitySettingsForm } from "@/components/instructor/availability-settings-form";
import { InstructorAvailabilityPreview } from "@/components/instructor/instructor-availability-preview";
import { GoogleCalendarCard } from "@/components/settings/google-calendar-card";
import { api } from "@/convex/_generated/api";
import { fetchQuery } from "convex/nextjs";

export default async function InstructorAvailabilityPage() {
  const user = await requireRole("instructor");
  const token = await getConvexAuthToken();
  if (!token) {
    return (
      <ProtectedLayout currentPath="/instructor/availability">
        <div className="container mx-auto p-4 md:p-8">
          <p className="text-muted-foreground">Authentication required.</p>
        </div>
      </ProtectedLayout>
    );
  }

  const instructorRecord = await fetchQuery(
    api.instructors.getInstructorByUserId,
    { userId: user.id },
    { token }
  );

  if (!instructorRecord) {
    return (
      <ProtectedLayout currentPath="/instructor/availability">
        <div className="container mx-auto p-4 md:p-8">
          <p className="text-muted-foreground">Instructor profile not found.</p>
        </div>
      </ProtectedLayout>
    );
  }

  return (
    <ProtectedLayout currentPath="/instructor/availability">
      <div className="container mx-auto p-4 md:p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Availability</h1>
          <p className="text-muted-foreground">
            Configure when students can book sessions with you.
          </p>
        </div>

        <SchedulingSettingsForm
          initialTimeZone={instructorRecord.timeZone ?? null}
          initialWorkingHours={instructorRecord.workingHours ?? null}
        />

        <AvailabilitySettingsForm
          initialBufferMinutes={instructorRecord.bufferMinutesBetweenSessions ?? null}
          initialMinBookingLeadMinutes={instructorRecord.minBookingLeadMinutes ?? null}
          initialMaxBookingAdvanceDays={instructorRecord.maxBookingAdvanceDays ?? null}
          initialBlockedDateRanges={instructorRecord.blockedDateRanges ?? null}
        />

        <GoogleCalendarCard />

        <InstructorAvailabilityPreview
          instructorId={instructorRecord._id}
          instructorName={instructorRecord.name ?? undefined}
        />
      </div>
    </ProtectedLayout>
  );
}
