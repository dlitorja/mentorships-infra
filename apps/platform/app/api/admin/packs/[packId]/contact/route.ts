import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getAuthenticatedConvexClient } from "@/lib/convex";
import { requireRoleForApi } from "@/lib/auth-helpers";
import { isForbiddenError, isUnauthorizedError } from "@/lib/errors";
import { sendEmail } from "@/lib/email";
import { buildPackCheckInEmail } from "@/lib/emails/pack-checkin-email";

/**
 * POST /api/admin/packs/[packId]/contact
 *
 * Sends the unused-sessions check-in email and records the contact on the pack.
 * The recipient is resolved server-side from the pack (never supplied by the
 * client), and only staff can call this.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ packId: string }> }
): Promise<NextResponse> {
  try {
    await requireRoleForApi("admin");
    const { packId } = await params;

    const convex = await getAuthenticatedConvexClient();
    const pack = await convex.query(api.packAttention.getPackForAdmin, {
      packId: packId as Id<"sessionPacks">,
    });

    if (!pack) {
      return NextResponse.json({ error: "Pack not found" }, { status: 404 });
    }
    if (!pack.email) {
      return NextResponse.json(
        { error: "No email on file for this student" },
        { status: 409 }
      );
    }

    const baseUrl =
      process.env.NEXT_PUBLIC_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

    const content = buildPackCheckInEmail({
      studentName: pack.studentName,
      instructorName: pack.instructorName,
      remainingSessions: pack.remainingSessions,
      totalSessions: pack.totalSessions,
      expiresAt: pack.expiresAt,
      bookingUrl: `${baseUrl}/calendar`,
    });

    const result = await sendEmail({
      to: pack.email,
      subject: content.subject,
      html: content.html,
      text: content.text,
      headers: { ...content.headers, "X-Session-Pack-Id": pack.packId },
      kind: "transactional",
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: "Email could not be sent" },
        { status: 502 }
      );
    }

    await convex.mutation(api.packAttention.recordPackContact, {
      packId: pack.packId,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("Pack check-in email failed:", error);
    return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
  }
}
