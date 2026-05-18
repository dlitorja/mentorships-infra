import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";

const listWorkspacesQuerySchema = z.object({
  type: z.enum(["mentorship", "admin_student", "admin_instructor"]).optional(),
  numItems: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

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
 * Owner and instructor data is enriched server-side by the Convex query,
 * eliminating the need for separate batch lookups.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const parsedQuery = listWorkspacesQuerySchema.safeParse(
      Object.fromEntries(new URL(req.url).searchParams)
    );

    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: "Invalid query", details: parsedQuery.error.issues },
        { status: 400 }
      );
    }

    const { type, numItems, cursor } = parsedQuery.data;
    const convex = getConvexClient();

    const paginationOpts = {
      numItems,
      cursor: cursor ?? null,
    };

    // Note: Convex codegen types may still reference "admin_mentee".
    // Runtime expects "admin_student" and server code supports it.
    // Cast here to avoid a transient TS mismatch blocking the build.
    const result = await convex.query(api.adminWorkspaces.getAllWorkspaces, {
      paginationOpts,
      type: type as any,
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
