import { requireRole } from "@/lib/auth-helpers";
import { ProtectedLayout } from "@/components/navigation/protected-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import {
  db,
  desc,
  eq,
  getMentorByUserId,
  menteeOnboardingSubmissions,
  users,
} from "@mentorships/db";
import { createSupabaseAdminClient, ONBOARDING_BUCKET } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ submissionId?: string }>;
};

export default async function InstructorOnboardingPage({ searchParams }: PageProps) {
  const user = await requireRole("mentor");
  const mentor = await getMentorByUserId(user.id);

  if (!mentor) {
    return (
      <ProtectedLayout currentPath="/instructor/onboarding">
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">
              Mentor profile not found. Please contact support.
            </p>
          </CardContent>
        </Card>
      </ProtectedLayout>
    );
  }

  const { submissionId } = await searchParams;

  const submissions = await db
    .select({
      id: menteeOnboardingSubmissions.id,
      goals: menteeOnboardingSubmissions.goals,
      imageObjects: menteeOnboardingSubmissions.imageObjects,
      createdAt: menteeOnboardingSubmissions.createdAt,
      reviewedAt: menteeOnboardingSubmissions.reviewedAt,
      studentId: menteeOnboardingSubmissions.userId,
      studentEmail: users.email,
    })
    .from(menteeOnboardingSubmissions)
    .innerJoin(users, eq(users.id, menteeOnboardingSubmissions.userId))
    .where(eq(menteeOnboardingSubmissions.mentorId, mentor.id))
    .orderBy(desc(menteeOnboardingSubmissions.createdAt));

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
      <div className="container mx-auto p-4 md:p-8 space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Onboarding</h1>
          <p className="text-muted-foreground mt-1">
            Review mentee onboarding submissions (goals + work images).
          </p>
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


