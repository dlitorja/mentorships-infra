import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

const listStudentsQuerySchema = z.object({
  search: z.string().optional(),
  instructorId: z.string().optional(),
  status: z.enum(["active", "depleted", "expired", "refunded"]).optional(),
  expiresAfter: z.coerce.number().optional(),
  expiresBefore: z.coerce.number().optional(),
  purchasedAfter: z.coerce.number().optional(),
  purchasedBefore: z.coerce.number().optional(),
  remainingMin: z.coerce.number().optional(),
  remainingMax: z.coerce.number().optional(),
  page: z.coerce.number().optional(),
  pageSize: z.coerce.number().optional(),
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
    console.error("Error listing students:", error);
    const message = error instanceof Error ? error.message : "Failed to list students";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
