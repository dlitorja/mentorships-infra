import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db, eq, getMentorByUserId, menteeOnboardingSubmissions } from "@mentorships/db";
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

    const [submission] = await db
      .select()
      .from(menteeOnboardingSubmissions)
      .where(eq(menteeOnboardingSubmissions.id, submissionId))
      .limit(1);

    if (!submission) {
      return NextResponse.json({ error: "Submission not found", errorId }, { status: 404 });
    }

    const isStudentOwner = submission.userId === user.id;

    let isMentorOwner = false;
    if (user.role === "mentor") {
      const mentor = await getMentorByUserId(user.id);
      isMentorOwner = Boolean(mentor && mentor.id === submission.mentorId);
    }

    if (!isStudentOwner && !isMentorOwner) {
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


