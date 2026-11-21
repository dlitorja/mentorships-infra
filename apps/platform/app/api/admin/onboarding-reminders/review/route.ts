import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getAuthenticatedConvexClient } from "@/lib/convex";
import { requireAdminOrSupportForApi } from "@/lib/auth-helpers";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { convexIdSchema } from "@/lib/validators";
import { inngest } from "@/inngest/client";
import { reportError } from "@/lib/observability";

const reviewSchema = z
  .object({
    ids: z.array(convexIdSchema).min(1).max(100),
    action: z.enum(["approve", "suppress"]),
    reason: z.string().max(1000).optional(),
  })
  .refine((value) => value.action !== "suppress" || Boolean(value.reason?.trim()), {
    message: "A reason is required to suppress a reminder",
    path: ["reason"],
  });

/**
 * POST /api/admin/onboarding-reminders/review
 *
 * Approves or suppresses a batch of staged onboarding reminders. Suppression is
 * the "do not send this one" record: the row keeps its dedupe key, so the
 * hourly scan will not queue the same nudge again.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    await requireAdminOrSupportForApi();

    const body = await req.json().catch(() => ({}));
    const parsed = reviewSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const convex = await getAuthenticatedConvexClient();
    const result = await convex.mutation(api.onboardingReminderReview.review, {
      ids: parsed.data.ids as Id<"onboardingReminders">[],
      action: parsed.data.action,
      reason: parsed.data.reason?.trim(),
    });

    if (parsed.data.action === "approve" && result.updated > 0) {
      // Send now instead of waiting for the next hourly tick. Best effort: the
      // rows are already approved, so a failed event only delays the send.
      try {
        await inngest.send({
          name: "onboarding/followups.send",
          data: { approved: result.updated },
        });
      } catch (error) {
        await reportError({
          source: "api/admin/onboarding-reminders/review",
          error,
          message: "Failed to trigger reminder send after approval",
          level: "warn",
        });
      }
    }

    return NextResponse.json({ ok: true, updated: result.updated });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json(
      { error: "Failed to review reminder" },
      { status: 500 }
    );
  }
}
