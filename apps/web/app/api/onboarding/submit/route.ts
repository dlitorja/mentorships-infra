import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { and, db, discordActionQueue, eq, sessionPacks } from "@mentorships/db";
import { requireDbUser } from "@/lib/auth";

const imageObjectSchema = z.object({
  path: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

const submitSchema = z.object({
  submissionId: z.string().uuid(),
  sessionPackId: z.string().uuid(),
  goals: z.string().min(10).max(5000),
  imageObjects: z.array(imageObjectSchema).min(2).max(4),
});

type SubmitResponse =
  | { success: true; submissionId: string }
  | { error: string; errorId: string };

function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_URL) return process.env.NEXT_PUBLIC_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.NODE_ENV === "production") {
    throw new Error("NEXT_PUBLIC_URL or VERCEL_URL must be set in production");
  }
  return "http://localhost:3000";
}

export async function POST(request: Request): Promise<NextResponse<SubmitResponse>> {
  const errorId = randomUUID();

  try {
    const user = await requireDbUser();
    const body = await request.json();
    const parsed = submitSchema.parse(body);

    const pack = await db
      .select()
      .from(sessionPacks)
      .where(and(eq(sessionPacks.id, parsed.sessionPackId), eq(sessionPacks.userId, user.id)))
      .limit(1);

    const sessionPack = pack[0] ?? null;
    if (!sessionPack) {
      return NextResponse.json(
        { error: "Session pack not found for user", errorId },
        { status: 404 }
      );
    }

    const expectedPrefix = `onboarding/${user.id}/${parsed.submissionId}/`;
    const allMatch = parsed.imageObjects.every((img) => img.path.startsWith(expectedPrefix));
    if (!allMatch) {
      return NextResponse.json(
        { error: "Invalid submission ID or image paths. Please upload images first.", errorId },
        { status: 400 }
      );
    }

    // Check Convex for idempotency
    const convex = getConvexClient();
    const existing = await convex.query(api.studentOnboarding.getByLegacyId, { legacyId: parsed.submissionId });
    if (existing) {
      return NextResponse.json(
        { error: "Submission already exists. Please refresh and try again.", errorId },
        { status: 409 }
      );
    }

    const instructor = await convex.query(api.instructors.getInstructorByUserId, {
      userId: sessionPack.userId,
    });

    if (!instructor) {
      return NextResponse.json(
        { error: "Instructor not found", errorId },
        { status: 404 }
      );
    }

    // Create submission in Convex (idempotent)
    const created = await convex.mutation(api.studentOnboarding.create, {
      legacyId: parsed.submissionId,
      userId: user.id,
      instructorId: instructor._id,
      sessionPackId: sessionPack.id, // legacy UUID stored in Postgres; Convex maps by legacyId
      goals: parsed.goals,
      imageObjects: parsed.imageObjects,
    });

    const baseUrl = getBaseUrl();
    const instructorOnboardingUrl = `${baseUrl}/instructor/onboarding?submissionId=${encodeURIComponent(
      parsed.submissionId
    )}`;

    await db.insert(discordActionQueue).values({
      type: "dm_instructor_new_signup",
      status: "pending",
      subjectUserId: user.id,
      instructorId: instructor._id,
      instructorUserId: instructor.userId ?? sessionPack.userId,
      payload: {
        kind: "onboarding_submission",
        submissionId: parsed.submissionId,
        sessionPackId: sessionPack.id,
        goals: parsed.goals,
        imageObjects: parsed.imageObjects.map((img) => ({
          path: img.path,
          mimeType: img.mimeType,
          sizeBytes: img.sizeBytes,
        })),
        instructorOnboardingUrl,
      },
    });

    return NextResponse.json({ success: true, submissionId: parsed.submissionId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error", errorId },
      { status: 500 }
    );
  }
}
