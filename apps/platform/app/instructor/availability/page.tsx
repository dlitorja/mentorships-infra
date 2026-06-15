import { requireRole } from "@/lib/auth-helpers";
import { ProtectedLayout } from "@/components/navigation/protected-layout";
import { SchedulingSettingsForm } from "@/components/instructor/scheduling-settings-form";
import { AvailabilitySettingsForm } from "@/components/instructor/availability-settings-form";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default async function InstructorAvailabilityPage() {
  const user = await requireRole("instructor");
  const convex = getConvexClient();
  const instructorRecord = await convex.query(api.instructors.getInstructorByUserId, { userId: user.id });

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
        <div className="flex items-center gap-4">
          <Link
            href="/instructor/settings"
            className="flex items-center text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to settings
          </Link>
        </div>

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

        <Card>
          <CardHeader>
            <CardTitle>Calendar Integration</CardTitle>
            <CardDescription>
              Connect your Google Calendar to show real-time availability based on your existing events.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/settings"
              className="text-sm text-primary hover:underline"
            >
              Manage Google Calendar connection
            </Link>
          </CardContent>
        </Card>
      </div>
    </ProtectedLayout>
  );
}