import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

const listStudentsQuerySchema = z.object({
  search: z.string().optional(),
  instructorId: z.string().optional(),
  status: z.enum(["active", "depleted", "expired", "refunded"]).optional(),
  // Timestamps: integers >= 0
  expiresAfter: z.coerce.number().int().min(0).optional(),
  expiresBefore: z.coerce.number().int().min(0).optional(),
  purchasedAfter: z.coerce.number().int().min(0).optional(),
  purchasedBefore: z.coerce.number().int().min(0).optional(),
  // Remaining sessions: integers >= 0
  remainingMin: z.coerce.number().int().min(0).optional(),
  remainingMax: z.coerce.number().int().min(0).optional(),
  // Pagination: integers >= 1
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).optional(),
});

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  return new ConvexHttpClient(convexUrl);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const parsedQuery = listStudentsQuerySchema.safeParse(
      Object.fromEntries(new URL(req.url).searchParams)
    );
    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: "Invalid query", details: parsedQuery.error.issues },
        { status: 400 }
      );
    }

    const convex = getConvexClient();
    const result = await convex.query(api.admin.getStudentsForAdmin, parsedQuery.data);

    return NextResponse.json(result);
  } catch (error: unknown) {
    // Log full error server-side; return generic messages to clients
    console.error("Error listing students:", error);
    let status = 500;
    if (error instanceof Error) {
      if (error.message === "Unauthorized") status = 401;
      else if (error.message.includes("Forbidden")) status = 403;
    }
    const payload =
      status === 401
        ? { error: "Unauthorized" }
        : status === 403
        ? { error: "Forbidden" }
        : { error: "Internal server error" };
    return NextResponse.json(payload, { status });
  }
}
