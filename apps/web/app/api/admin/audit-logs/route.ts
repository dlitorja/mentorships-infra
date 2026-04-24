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
 * GET /api/admin/audit-logs
 * List all workspace audit logs for admin with pagination
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const convex = getConvexClient();

    const url = new URL(req.url);
    const numItems = Math.min(parseInt(url.searchParams.get("numItems") || "50") || 50, 100);
    const cursor = url.searchParams.get("cursor");

    const paginationOpts = {
      numItems,
      cursor: cursor || null,
    };

    const result = await convex.query(api.adminWorkspaces.getAllAuditLogs, {
      paginationOpts,
    });

    return NextResponse.json({
      items: result.page.map((log) => ({
        id: log._id,
        workspaceId: log.workspaceId,
        adminId: log.adminId,
        action: log.action,
        details: log.details,
        timestamp: log.timestamp,
      })),
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to list audit logs";
    console.error("Error listing audit logs:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
