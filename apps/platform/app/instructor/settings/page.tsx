import Link from "next/link";
import { requireRole, getConvexAuthToken } from "@/lib/auth-helpers";
import { api } from "@/convex/_generated/api";
import { fetchQuery } from "convex/nextjs";
import { ExternalLink, Pencil } from "lucide-react";

import { ProtectedLayout } from "@/components/navigation/protected-layout";
import { InstructorTimezoneSettingsForm } from "@/components/instructor/instructor-timezone-settings-form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

/**
 * Instructor settings — intentionally scoped to profile + timezone.
 *
 * Availability and scheduling are NOT configured here (those live on
 * `/instructor/availability` and are out of scope for now). The
 * instructor-side onboarding review links here when the instructor
 * hasn't saved a timezone yet.
 */
export default async function InstructorSettingsPage() {
  const user = await requireRole("instructor");
  const token = await getConvexAuthToken();

  if (!token) {
    return (
      <ProtectedLayout currentPath="/instructor/settings">
        <div className="container mx-auto p-4 md:p-8">
          <p className="text-muted-foreground">
            Authentication required. Please sign in again.
          </p>
        </div>
      </ProtectedLayout>
    );
  }

  const instructor = await fetchQuery(
    api.instructors.getInstructorByUserId,
    { userId: user.id },
    { token }
  );

  if (!instructor) {
    return (
      <ProtectedLayout currentPath="/instructor/settings">
        <div className="container mx-auto p-4 md:p-8">
          <p className="text-muted-foreground">
            Instructor profile not found. Please contact support.
          </p>
        </div>
      </ProtectedLayout>
    );
  }

  const publicProfileHref = instructor.slug
    ? `/instructors/${instructor.slug}`
    : null;

  return (
    <ProtectedLayout currentPath="/instructor/settings">
      <div className="container mx-auto p-4 md:p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground">
            Manage your instructor profile and timezone.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Instructor profile</CardTitle>
            <CardDescription>
              Edit the public profile students see on the instructors page.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/instructor/profile">
                <Pencil className="mr-2 h-4 w-4" />
                Edit profile
              </Link>
            </Button>
            {publicProfileHref && (
              <Button asChild variant="outline">
                <Link
                  href={publicProfileHref}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  View public profile
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>

        <InstructorTimezoneSettingsForm
          initialTimeZone={instructor.timeZone ?? null}
        />
      </div>
    </ProtectedLayout>
  );
}
