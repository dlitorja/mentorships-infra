import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { requireRoleForApi } from "@/lib/auth-helpers";
import { auth } from "@clerk/nextjs/server";

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

    const result = await convex.query(api.admin.getStudentsForAdmin as any, {
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
    });

    return NextResponse.json({
      items: result.items.map((it: any) => ({
        ...it,
        purchasedAt: new Date(it.purchasedAt).toISOString(),
        expiresAt: it.expiresAt ? new Date(it.expiresAt).toISOString() : null,
        createdAt: new Date(it.createdAt).toISOString(),
      })),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message.includes("Forbidden")) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }
    console.error("Error listing students:", error);
    return NextResponse.json({ error: "Failed to list students" }, { status: 500 });
  }
}
