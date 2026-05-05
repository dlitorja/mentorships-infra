import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clerkClient } from "@clerk/nextjs/server";
import { api } from "@/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  return new ConvexHttpClient(convexUrl);
}

interface ClerkUserName {
  firstName?: string | null;
  lastName?: string | null;
}

const listMenteesQuerySchema = z.object({
  search: z.string().trim().default(""),
  instructorId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * GET /api/admin/mentees
 * List all mentees with their session packs and instructor info
 */
export async function GET(req: NextRequest) {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const parsedQuery = listMenteesQuerySchema.safeParse(
      Object.fromEntries(new URL(req.url).searchParams)
    );

    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: "Invalid query", details: parsedQuery.error.issues },
        { status: 400 }
      );
    }

    const { search, instructorId, page, pageSize } = parsedQuery.data;
    const convex = getConvexClient();

    const result = await convex.query(api.admin.getAllMenteesForAdmin, {
      search: search || undefined,
      instructorId: instructorId as any || undefined,
      page,
      pageSize,
    });

    const userIds = [...new Set(result.items.map((m: any) => m.userId))];
    let clerkUserMap = new Map<string, ClerkUserName>();

    if (userIds.length > 0) {
      try {
        const client = await clerkClient();
        const clerkResponse = await client.users.getUserList({ userId: userIds, limit: Math.min(userIds.length, 500) });
        clerkUserMap = new Map(clerkResponse.data.map((u) => [u.id, { firstName: u.firstName, lastName: u.lastName }]));
      } catch (error) {
        console.error("Failed to fetch Clerk user names for mentees:", error);
      }
    }

    return NextResponse.json({
      items: result.items.map((m: any) => {
        const clerkUser = clerkUserMap.get(m.userId);
        return {
          kind: "mentee" as const,
          id: m.id,
          userId: m.userId,
          email: m.email || "Unknown",
          firstName: clerkUser?.firstName ?? null,
          lastName: clerkUser?.lastName ?? null,
          mentorId: m.mentorId,
          instructorName: m.instructorName || "Unknown",
          instructorSlug: m.instructorSlug,
          totalSessions: m.totalSessions,
          remainingSessions: m.remainingSessions,
          status: m.status,
          expiresAt: m.expiresAt ? new Date(m.expiresAt).toISOString() : null,
          purchasedAt: new Date(m.purchasedAt).toISOString(),
        };
      }),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }

    console.error("Error listing mentees:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list mentees" },
      { status: 500 }
    );
  }
}