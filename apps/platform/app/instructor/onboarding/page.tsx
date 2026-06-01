import { requireRole } from "@/lib/auth-helpers";
import { ProtectedLayout } from "@/components/navigation/protected-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { SchedulingSettingsForm } from "@/components/instructor/scheduling-settings-form";
import { EnsureInstructorRole } from "@/components/instructor/ensure-instructor-role";
import { GoogleCalendarStatus } from "@/components/instructor/google-calendar-status";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import {
  db,
  desc,
  eq,
  getInstructorByUserId,
  studentOnboardingSubmissions,
  users,
} from "@mentorships/db";
import { createSupabaseAdminClient, ONBOARDING_BUCKET } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ submissionId?: string }>;
};

/**
 * Instructor onboarding page for initial setup and profile completion.
 * Displays submission review status, Google Calendar connection,
 * and scheduling settings configuration.
 */
export default async function InstructorOnboardingPage({ searchParams }: PageProps) {
  const user = await requireRole("instructor");
  const instructorRecord = await getInstructorByUserId(user.id);
  const convex = getConvexClient();
  const convexInstructor = await convex.query(api.instructors.getInstructorByUserId, { userId: user.id });

  if (!instructorRecord) {
    return (
      <ProtectedLayout currentPath="/instructor/onboarding">
        {/* Silent role sync for Convex */}
        <EnsureInstructorRole />
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">
              Instructor profile not found. Please contact support.
            </p>
          </CardContent>
        </Card>
      </ProtectedLayout>
    );
  }

  const { submissionId } = await searchParams;

  const submissions: {
    id: string;
    goals: string;
    imageObjects: { path: string }[];
    createdAt: Date;
    reviewedAt: Date | null;
    studentId: string;
    studentEmail: string;
  }[] = await db
    .select({
      id: studentOnboardingSubmissions.id,
      goals: studentOnboardingSubmissions.goals,
      imageObjects: studentOnboardingSubmissions.imageObjects,
      createdAt: studentOnboardingSubmissions.createdAt,
      reviewedAt: studentOnboardingSubmissions.reviewedAt,
      studentId: studentOnboardingSubmissions.userId,
      studentEmail: users.email,
    })
    .from(studentOnboardingSubmissions)
    .innerJoin(users, eq(users.id, studentOnboardingSubmissions.userId))
    .where(eq(studentOnboardingSubmissions.instructorId, instructorRecord.id))
    .orderBy(desc(studentOnboardingSubmissions.createdAt));

  const selected =
    (submissionId ? submissions.find((s) => s.id === submissionId) : null) ?? submissions[0] ?? null;

  const signedUrls =
    selected && selected.imageObjects.length > 0
      ? await (async () => {
          const supabase = createSupabaseAdminClient();
          const out: Array<{ path: string; signedUrl: string }> = [];

          for (const img of selected.imageObjects) {
            const { data, error } = await supabase.storage
              .from(ONBOARDING_BUCKET)
              .createSignedUrl(img.path, 60 * 60);
            if (error || !data?.signedUrl) continue;
            out.push({ path: img.path, signedUrl: data.signedUrl });
          }

          return out;
        })()
      : [];

  return (
    <ProtectedLayout currentPath="/instructor/onboarding">
      {/* Silent role sync for Convex */}
      <EnsureInstructorRole />
      <div className="container mx-auto p-4 md:p-8 space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Onboarding</h1>
          <p className="text-muted-foreground mt-1">
            Complete your profile and scheduling, then review student onboarding submissions.
          </p>
        </div>

        {/* Scheduling setup section */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle>Profile & Scheduling</CardTitle>
              <CardDescription>
                Set your time zone and working hours. You can edit profile details from the admin if needed.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SchedulingSettingsForm
                initialTimeZone={(convexInstructor as any)?.timeZone ?? null}
                initialWorkingHours={(convexInstructor as any)?.workingHours ?? null}
              />
            </CardContent>
          </Card>
        </div>

        {/* Calendar connect section */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle>Connect Google Calendar</CardTitle>
              <CardDescription>
                Connect your calendar so students can book sessions and see your availability in real-time.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <GoogleCalendarStatus
                isCalendarConnected={!!convexInstructor?.googleRefreshToken}
              />
            </CardContent>
          </Card>
        </div>

        {submissions.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
              <p className="text-center text-muted-foreground">No onboarding submissions yet.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Submissions</CardTitle>
                <CardDescription>Most recent first</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {submissions.map((s) => (
                  <Link
                    key={s.id}
                    href={`/instructor/onboarding?submissionId=${encodeURIComponent(s.id)}`}
                    className={`block rounded-md border p-3 hover:bg-muted ${
                      selected?.id === s.id ? "bg-muted" : ""
                    }`}
                  >
                    <div className="text-sm font-medium">{s.studentEmail}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(s.createdAt).toLocaleString()}
                      {s.reviewedAt ? " · reviewed" : ""}
                    </div>
                  </Link>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Details</CardTitle>
                <CardDescription>
                  {selected ? `From ${selected.studentEmail}` : "Select a submission"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {selected ? (
                  <>
                    <div className="space-y-2">
                      <div className="text-sm font-medium">Goals</div>
                      <div className="whitespace-pre-wrap text-sm text-muted-foreground">
                        {selected.goals}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="text-sm font-medium">Images</div>
                      {signedUrls.length === 0 ? (
                        <div className="text-sm text-muted-foreground">
                          No images (or signing not configured).
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-3">
                          {signedUrls.map((u) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              key={u.path}
                              src={u.signedUrl}
                              alt="Onboarding work"
                              className="w-full rounded-md border object-cover"
                            />
                          ))}
                        </div>
                      )}
                    </div>

                    <form action={`/api/instructor/onboarding/review`} method="post">
                      <input type="hidden" name="submissionId" value={selected.id} />
                      <Button type="submit" disabled={Boolean(selected.reviewedAt)}>
                        {selected.reviewedAt ? "Reviewed" : "Mark reviewed"}
                      </Button>
                    </form>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Select a submission to view details.</p>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </ProtectedLayout>
  );
}
