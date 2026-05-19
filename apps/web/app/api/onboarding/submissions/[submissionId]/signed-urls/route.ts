import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { requireDbUser } from "@/lib/auth";
import { createSupabaseAdminClient, ONBOARDING_BUCKET } from "@/lib/supabase-admin";

type SignedUrlResponse =
  | {
      success: true;
      submissionId: string;
      urls: Array<{ path: string; signedUrl: string }>;
    }
  | { error: string; errorId: string };

export async function GET(
  _request: Request,
  context: { params: Promise<{ submissionId: string }> }
): Promise<NextResponse<SignedUrlResponse>> {
  const errorId = randomUUID();

  try {
    const user = await requireDbUser();
    const { submissionId } = await context.params;

    const convex = getConvexClient();
    const submission = await convex.query(api.studentOnboarding.getByLegacyId, { legacyId: submissionId });

    if (!submission) {
      return NextResponse.json({ error: "Submission not found", errorId }, { status: 404 });
    }

    const isStudentOwner = submission.userId === user.id;

    let isInstructorOwner = false;
    if (user.role === "instructor") {
      const instructor = await convex.query(api.instructors.getInstructorByUserId, { userId: user.id });
      isInstructorOwner = Boolean(instructor && instructor._id === submission.instructorId);
    }

    if (!isStudentOwner && !isInstructorOwner) {
      return NextResponse.json({ error: "Forbidden", errorId }, { status: 403 });
    }

    const supabase = createSupabaseAdminClient();
    const urls: Array<{ path: string; signedUrl: string }> = [];

    for (const img of submission.imageObjects) {
      const { data, error } = await supabase.storage
        .from(ONBOARDING_BUCKET)
        .createSignedUrl(img.path, 60 * 60);

      if (error || !data?.signedUrl) {
        return NextResponse.json(
          { error: `Failed to sign URL for ${img.path}`, errorId },
          { status: 500 }
        );
      }

      urls.push({ path: img.path, signedUrl: data.signedUrl });
    }

    return NextResponse.json({ success: true, submissionId, urls });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error", errorId },
      { status: 500 }
    );
  }
}
