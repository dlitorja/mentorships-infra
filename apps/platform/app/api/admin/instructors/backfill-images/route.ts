import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { fetchAction } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { z } from "zod";

export const runtime = "nodejs";

/**
 * POST /api/admin/instructors/backfill-images
 * Body: { baseUrl?: string; includeStudentResults?: boolean; dryRun?: boolean; limit?: number }
 * Requires admin. Triggers Convex action to backfill storage-backed images for instructors, profiles, and student results.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const schema = z.object({
      baseUrl: z.string().trim().min(1).optional(),
      includeStudentResults: z.coerce.boolean().optional(),
      dryRun: z.coerce.boolean().optional(),
      limit: z.coerce.number().int().positive().optional(),
    });

    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.issues }, { status: 400 });
    }

    const baseUrl = parsed.data.baseUrl ?? process.env.NEXT_PUBLIC_URL ?? req.headers.get("origin") ?? "";
    if (!baseUrl) {
      return NextResponse.json({ error: "baseUrl is required (set NEXT_PUBLIC_URL or pass in body)" }, { status: 400 });
    }
    const includeStudentResults = parsed.data.includeStudentResults ?? true;
    const dryRun = parsed.data.dryRun ?? false;
    const limit = parsed.data.limit;

    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!convexUrl) {
      return NextResponse.json({ error: "NEXT_PUBLIC_CONVEX_URL is not set" }, { status: 500 });
    }
    const clerkAuth = await auth();
    const token = await clerkAuth.getToken({ template: "convex" });
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await fetchAction(
      api.instructors.backfillImages,
      { baseUrl, includeStudentResults, dryRun, limit },
      { token, url: convexUrl }
    );

    return NextResponse.json({ success: true, summary: result });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("Unauthorized") || error.message.includes("Forbidden") || error.message.includes("Admin role required"))
    ) {
      return NextResponse.json(
        { error: error.message },
        { status: error.message.includes("Unauthorized") ? 401 : 403 }
      );
    }
    console.error("Backfill images error:", error);
    return NextResponse.json({ error: "Backfill failed" }, { status: 500 });
  }
}
