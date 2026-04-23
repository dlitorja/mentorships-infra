import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

/**
 * GET /api/admin/audit-logs
 * List all workspace audit logs for admin with pagination
 */
export async function GET(req: NextRequest) {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const url = new URL(req.url);
    const numItems = parseInt(url.searchParams.get("numItems") || "50");

    const paginationOpts = {
      numItems,
      cursor: null as string | null,
    };

    const result = await convex.query(api.adminWorkspaces.getAllAuditLogs, {
      paginationOpts,
    });

    return NextResponse.json({
      items: result.page.map((log: any) => ({
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
  } catch (error: any) {
    console.error("Error listing audit logs:", error);
    return NextResponse.json(
      { error: error.message || "Failed to list audit logs" },
      { status: 500 }
    );
  }
}
