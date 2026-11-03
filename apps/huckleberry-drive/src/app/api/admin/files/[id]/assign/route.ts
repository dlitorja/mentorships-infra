import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { revokeShareViaWorker } from "@/lib/kv";

interface Params {
  params: Promise<{ id: string }>;
}

const assignSchema = z.object({
  // `null` clears the assignment; a string assigns or reassigns it.
  instructorId: z.string().trim().min(1).nullable(),
});

/**
 * Assign an instructor to an upload that was created without one.
 * Admin-only; the Convex mutation re-validates the caller and the
 * target instructor (active profile, active user, `instructor` role).
 */
export async function POST(
  request: NextRequest,
  { params }: Params
): Promise<NextResponse> {
  try {
    await requireAdmin();
    const { id } = await params;
    const { getToken } = await auth();
    const token = await getToken({ template: "convex" }) ?? undefined;

    const body = await request.json();
    const parsed = assignSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Any instructor change invalidates existing share links. Revoke
    // them through the Worker *before* changing the row so the KV
    // revocation marker is written first; cached share downloads stop
    // immediately instead of lasting until the cache TTL. Skip the
    // revocation on a no-op assignment (the UI disables Save, but a
    // direct API call could still land here).
    const current = await fetchQuery(
      api.instructorUploads.getUploadById,
      { id },
      { token }
    ) as { instructorId?: string } | null;
    const nextInstructorId = parsed.data.instructorId ?? undefined;
    const isNoop =
      current !== null &&
      (current.instructorId ?? undefined) === nextInstructorId;

    if (!isNoop) {
      const activeShareTokens = await fetchQuery(
        api.hdShareLinks.listActiveShareTokensForUpload,
        { uploadLegacyId: id },
        { token }
      ) as string[];

      if (activeShareTokens.length > 0) {
        if (!token) {
          return NextResponse.json(
            { error: "Cannot revoke share links without a Convex token" },
            { status: 500 }
          );
        }
        for (const shareToken of activeShareTokens) {
          await revokeShareViaWorker(shareToken, token);
        }
      }
    }

    const result = await fetchMutation(
      api.instructorUploads.assignUploadInstructor,
      { id, instructorId: parsed.data.instructorId },
      { token }
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error("Assign upload instructor error:", error);

    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
