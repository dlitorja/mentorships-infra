import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { api } from "@/convex/_generated/api";
import { getAuthenticatedConvexClient } from "@/lib/convex";
import { requireDbUser } from "@/lib/auth";

type SignedUrlResponse =
  | {
      success: true;
      submissionId: string;
      urls: Array<{ storageId: string; signedUrl: string }>;
    }
  | { error: string; errorId: string };

export async function GET(
  _request: Request,
  context: { params: Promise<{ submissionId: string }> }
): Promise<NextResponse<SignedUrlResponse>> {
  const errorId = randomUUID();

  try {
    await requireDbUser();
    const { submissionId } = await context.params;

    const convex = await getAuthenticatedConvexClient();
    const submission = await convex.query(api.studentOnboarding.getByLegacyId, { legacyId: submissionId });

    if (!submission) {
      return NextResponse.json({ error: "Submission not found", errorId }, { status: 404 });
    }

    const urls = await convex.query(
      api.studentOnboarding.getSignedUrls,
      { submissionId: submission._id }
    );

    return NextResponse.json({ success: true, submissionId, urls });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error", errorId },
      { status: 500 }
    );
  }
}
