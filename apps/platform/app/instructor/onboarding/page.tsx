import { requireRole, getConvexAuthToken } from "@/lib/auth-helpers";
import { ProtectedLayout } from "@/components/navigation/protected-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { EnsureInstructorRole } from "@/components/instructor/ensure-instructor-role";
import { api } from "@/convex/_generated/api";
import { fetchQuery } from "convex/nextjs";
import { createSupabaseAdminClient, ONBOARDING_BUCKET } from "@/lib/supabase-admin";
import type { Id } from "@/convex/_generated/dataModel";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ submissionId?: string }>;
};

/**
 * Instructor submissions page for reviewing student onboarding submissions.
 * Profile, scheduling, and calendar integration are managed under
 * /instructor/profile and /instructor/availability.
 */
export default async function InstructorOnboardingPage({ searchParams }: PageProps) {
  const user = await requireRole("instructor");
  const token = await getConvexAuthToken();
  if (!token) {
    return (
      <ProtectedLayout currentPath="/instructor/onboarding">
        {/* Silent role sync for Convex */}
        <EnsureInstructorRole />
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">
              Authentication required.
            </p>
          </CardContent>
        </Card>
      </ProtectedLayout>
    );
  }

  const convexInstructor = await fetchQuery(
    api.instructors.getInstructorByUserId,
    { userId: user.id },
    { token }
  );

  if (!convexInstructor) {
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
    _id: Id<"studentOnboardingSubmissions">;
    legacyId: string | undefined;
    goals: string;
    imageObjects: any;
    imageStorageIds: (Id<"_storage"> | string)[] | undefined;
    createdAt: number | undefined;
    reviewedAt: number | undefined;
    userId: string;
    studentEmail: string;
  }[] = await fetchQuery(
    api.studentOnboarding.listByInstructor,
    {
      instructorId: convexInstructor._id,
    },
    { token }
  );

  const selected =
    (submissionId ? submissions.find((s) => s.legacyId === submissionId || s._id === submissionId) : null) ?? submissions[0] ?? null;

  const signedUrls: Array<{ storageId?: string; path?: string; signedUrl: string }> = await (async () => {
    if (!selected) return [];

    // Prefer Convex Storage; only fall back to Supabase for legacy submissions
    // that have not been migrated yet.
    if (selected.imageStorageIds && selected.imageStorageIds.length > 0) {
      const urls = await fetchQuery(
        api.studentOnboarding.getSignedUrls,
        { submissionId: selected._id },
        { token }
      );
      return urls.map((u) => ({ storageId: u.storageId, signedUrl: u.signedUrl }));
    }

    const imageObjects = selected.imageObjects;
    if (!Array.isArray(imageObjects) || imageObjects.length === 0) return [];

    const supabase = createSupabaseAdminClient();
    const out: Array<{ storageId?: string; path: string; signedUrl: string }> = [];

    for (const img of imageObjects) {
      const path = typeof img === "object" && img !== null && "path" in img ? (img as { path: string }).path : String(img);
      const { data, error } = await supabase.storage
        .from(ONBOARDING_BUCKET)
        .createSignedUrl(path, 60 * 60);
      if (error || !data?.signedUrl) continue;
      out.push({ path, signedUrl: data.signedUrl });
    }

    return out;
  })();

  return (
    <ProtectedLayout currentPath="/instructor/onboarding">
      {/* Silent role sync for Convex */}
      <EnsureInstructorRole />
      <div className="container mx-auto p-4 md:p-8 space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Student Onboarding Submissions</h1>
          <p className="text-muted-foreground mt-1">
            Review goals and artwork from students before their sessions.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Instructor Setup</CardTitle>
            <CardDescription>
              Update your profile, availability, and calendar connection in one place.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button variant="outline" asChild>
              <Link href="/instructor/profile">Edit Profile</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/instructor/availability">Set Availability</Link>
            </Button>
          </CardContent>
        </Card>

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
                {submissions.map((s) => {
                  const submissionIdVal = s.legacyId ?? s._id;
                  return (
                  <Link
                    key={s._id}
                    href={`/instructor/onboarding?submissionId=${encodeURIComponent(submissionIdVal)}`}
                    className={`block rounded-md border p-3 hover:bg-muted ${
                      (selected?.legacyId ?? selected?._id) === submissionIdVal ? "bg-muted" : ""
                    }`}
                  >
                    <div className="text-sm font-medium">{s.studentEmail}</div>
                    <div className="text-xs text-muted-foreground">
                      {s.createdAt != null ? new Date(s.createdAt).toLocaleString() : "N/A"}
                      {s.reviewedAt ? " · reviewed" : ""}
                    </div>
                  </Link>
                );
                })}
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
                              key={u.storageId ?? u.path}
                              src={u.signedUrl}
                              alt="Onboarding work"
                              className="w-full rounded-md border object-cover"
                            />
                          ))}
                        </div>
                      )}
                    </div>

                    <form action={`/api/instructor/onboarding/review`} method="post">
                      {selected.legacyId ? (
                        <>
                          <input type="hidden" name="submissionId" value={selected.legacyId} />
                          <Button type="submit" disabled={Boolean(selected.reviewedAt)}>
                            {selected.reviewedAt ? "Reviewed" : "Mark reviewed"}
                          </Button>
                          {selected.reviewedAt && (
                            <p className="text-sm text-muted-foreground mt-2">
                              Reviewed on {new Date(selected.reviewedAt).toLocaleDateString()}
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground">Legacy ID not available for this submission.</p>
                      )}
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
