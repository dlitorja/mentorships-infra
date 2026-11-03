import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/auth";

interface Params {
  params: Promise<{ id: string }>;
}

const assignSchema = z.object({
  instructorId: z.string().trim().min(1),
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
