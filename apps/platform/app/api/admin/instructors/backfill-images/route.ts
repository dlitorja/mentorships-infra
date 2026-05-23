import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { fetchAction } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

export const runtime = "nodejs";

/**
 * POST /api/admin/instructors/backfill-images
 * Body: { baseUrl?: string; includeStudentResults?: boolean; dryRun?: boolean; limit?: number }
 * Requires admin. Triggers Convex action to backfill storage-backed images for instructors, profiles, and student results.
 */
export async function POST(req: NextRequest) {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const body = await req.json().catch(() => ({}));
    const baseUrl: string = body.baseUrl || process.env.NEXT_PUBLIC_URL || req.headers.get("origin") || "";
    if (!baseUrl) {
      return NextResponse.json({ error: "baseUrl is required (set NEXT_PUBLIC_URL or pass in body)" }, { status: 400 });
    }
    const includeStudentResults: boolean = body.includeStudentResults !== false;
    const dryRun: boolean = !!body.dryRun;
    const limit: number | undefined = typeof body.limit === "number" ? body.limit : undefined;

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
    if (error instanceof Error && (error.message.includes("Unauthorized") || error.message.includes("Forbidden"))) {
      return NextResponse.json({ error: error.message }, { status: error.message.includes("Unauthorized") ? 401 : 403 });
    }
    console.error("Backfill images error:", error);
    return NextResponse.json({ error: "Backfill failed" }, { status: 500 });
  }
}
