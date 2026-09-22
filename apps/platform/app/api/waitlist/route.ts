import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getAuthenticatedConvexClient } from "@/lib/convex";
import { auth } from "@clerk/nextjs/server";
import { getClerkUserEmail } from "@/lib/auth-helpers";
import { isUnauthorizedError } from "@/lib/errors";

// Check waitlist status for the authenticated user's email + instructorSlug.
// Requires authentication to prevent arbitrary email lookup. Uses an
// authenticated Convex client so the server-side identity check in
// getWaitlistStatus (admin OR matching own email) succeeds; a bare
// ConvexHttpClient would always read identity=null and return false.
//
// Note: there is no POST handler on this route. PR #861 made
// `waitlist.addToWaitlist` an internal Convex mutation, so the only public
// write path is `waitlist.actionAddToWaitlist` (which runs Turnstile
// siteverify before the internal mutation). The platform /waitlist page
// calls the action directly via the `useAddToWaitlist` hook; the legacy
// Supabase-backed POST handler at apps/web/app/api/waitlist/route.ts is the
// historical dual-write and is separate from this route.
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const email = await getClerkUserEmail(userId);
    if (!email) {
      return NextResponse.json({ error: "No email found" }, { status: 400 });
    }

    const { searchParams } = new URL(req.url);
    const instructorSlug = searchParams.get("instructorSlug");
    if (!instructorSlug) {
      return NextResponse.json({ onWaitlist: false, entries: [] });
    }

    const convex = await getAuthenticatedConvexClient();
    const status = await convex.query(api.waitlist.getWaitlistStatus, {
      email,
      instructorSlug,
    } as any);

    return NextResponse.json({
      onWaitlist: !!status?.onWaitlist,
      entries: status?.onWaitlist
        ? [
            {
              id: `${email}:${instructorSlug}`,
              instructorSlug,
              type: status.mentorshipType,
              createdAt: status.createdAt ? new Date(status.createdAt).toISOString() : null,
            },
          ]
        : [],
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Waitlist GET error:", error);
    return NextResponse.json({ error: "Failed to fetch waitlist status" }, { status: 500 });
  }
}
