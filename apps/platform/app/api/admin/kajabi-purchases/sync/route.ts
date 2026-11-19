import { NextResponse } from "next/server";
import { requireAdminOrSupportForApi } from "@/lib/auth-helpers";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { inngest } from "@/inngest/client";

/**
 * POST /api/admin/kajabi-purchases/sync
 * Manually kicks the Resend inbox poll (the cron runs every 5 minutes).
 */
export async function POST(): Promise<NextResponse> {
  try {
    await requireAdminOrSupportForApi();
    await inngest.send({
      name: "kajabi/inbox.sync",
      data: {},
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
