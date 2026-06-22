import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { requireRoleForApi } from "@/lib/auth-helpers";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { auth } from "@clerk/nextjs/server";

type ConvexSessionPack = {
  id: string;
  instructorId: string;
  instructorName: string | null;
  instructorSlug: string | null;
  totalSessions: number;
  remainingSessions: number;
  purchasedAt: number;
  expiresAt: number | null;
  status: string;
};

type ConvexStudent = {
  userId: string;
  email: string | null;
  sessionPacks: ConvexSessionPack[];
};

type GetStudentsForAdminResult = {
  items: ConvexStudent[];
  total: number;
  page: number;
  pageSize: number;
};

const listStudentsQuerySchema = z.object({
  search: z.string().trim().default(""),
  instructorId: z.string().optional(),
  status: z.enum(["active", "depleted", "expired", "refunded"]).optional(),
  expiresAfter: z.coerce.number().optional(),
  expiresBefore: z.coerce.number().optional(),
  purchasedAfter: z.coerce.number().optional(),
  purchasedBefore: z.coerce.number().optional(),
  remainingMin: z.coerce.number().int().optional(),
  remainingMax: z.coerce.number().int().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * GET /api/admin/students
 * Lists students with optional filtering by search, instructor, status, dates.
 * Requires admin role. Supports pagination (page, pageSize) and various
 * filters (expiresAfter/Before, purchasedAfter/Before, remainingMin/Max).
 * Returns paginated student list with session pack info.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRoleForApi("admin");

    const parsed = listStudentsQuerySchema.safeParse(
      Object.fromEntries(new URL(req.url).searchParams)
    );
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid query", details: parsed.error.issues }, { status: 400 });
    }

    const {
      search,
      instructorId,
      status,
      expiresAfter,
      expiresBefore,
      purchasedAfter,
      purchasedBefore,
      remainingMin,
      remainingMax,
      page,
      pageSize,
    } = parsed.data;

    const convex = getConvexClient();
    const clerkAuth = await auth();
    const token = await clerkAuth.getToken({ template: "convex" });
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    convex.setAuth(token);

    let result: GetStudentsForAdminResult;
    try {
      result = (await convex.query(api.admin.getStudentsForAdmin, {
        search: search || undefined,
        instructorId: instructorId || undefined,
        status: status || undefined,
        expiresAfter,
        expiresBefore,
        purchasedAfter,
        purchasedBefore,
        remainingMin,
        remainingMax,
        page,
        pageSize,
      })) as GetStudentsForAdminResult;
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err)) || "";
      if (msg.includes("Server Error")) {
        console.error("[admin/students] Convex server error, returning empty result set:", err);
        // Degraded mode: do not 500 the UI; signal partial content
        return NextResponse.json(
          { items: [], total: 0, page, pageSize },
          { status: 206 }
        );
      }
      throw err;
    }

    return NextResponse.json({
      items: result.items.map((student) => ({
        userId: student.userId,
        email: student.email,
        sessionPacks: (student.sessionPacks ?? []).map((pack) => ({
          id: pack.id,
          instructorId: pack.instructorId,
          instructorName: pack.instructorName,
          instructorSlug: pack.instructorSlug,
          totalSessions: pack.totalSessions,
          remainingSessions: pack.remainingSessions,
          status: pack.status,
          purchasedAt: new Date(pack.purchasedAt).toISOString(),
          expiresAt: pack.expiresAt ? new Date(pack.expiresAt).toISOString() : null,
        })),
      })),
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
    console.error("Error listing students:", error);
    return NextResponse.json({ error: "Failed to list students" }, { status: 500 });
  }
}
