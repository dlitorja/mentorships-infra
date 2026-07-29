import { requireRole, getConvexAuthToken } from "@/lib/auth-helpers";
import { api } from "@/convex/_generated/api";
import { fetchQuery } from "convex/nextjs";
import { ProtectedLayout } from "@/components/navigation/protected-layout";
import { Card, CardContent } from "@/components/ui/card";
import { InstructorSessionsClient } from "./instructor-sessions-client";

export default async function InstructorSessionsPage() {
  const user = await requireRole("instructor");
  const token = await getConvexAuthToken();
  const instructor = await fetchQuery(
    api.instructors.getInstructorByUserId,
    { userId: user.id },
    { token: token ?? undefined }
  );

  if (!instructor) {
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

  return (
    <ProtectedLayout currentPath="/instructor/sessions">
      <div className="container mx-auto p-4 md:p-8">
        <InstructorSessionsClient instructorId={instructor._id} />
      </div>
    </ProtectedLayout>
  );
}
