import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  return new ConvexHttpClient(convexUrl);
}

/**
 * GET /api/admin/workspaces
 * List all workspaces for admin with filtering and pagination.
 * Owner and mentor data is enriched server-side by the Convex query,
 * eliminating the need for separate batch lookups.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const convex = getConvexClient();

    const url = new URL(req.url);
    const type = url.searchParams.get("type") as "mentorship" | "admin_mentee" | "admin_instructor" | null;
    const numItems = parseInt(url.searchParams.get("numItems") || "50");
    const cursor = url.searchParams.get("cursor");

    const paginationOpts = {
      numItems,
      cursor: cursor || null,
    };

    const result = await convex.query(api.adminWorkspaces.getAllWorkspaces, {
      paginationOpts,
      type: type || undefined,
    });

    return NextResponse.json({
      items: result.page,
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    });
  } catch (error: unknown) {
    console.error("Error listing workspaces:", error);
    const message = error instanceof Error ? error.message : "Failed to list workspaces";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}