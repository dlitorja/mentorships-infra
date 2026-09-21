import { currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { isAdmin } from "@/lib/auth";
import { getConvexClient } from "@/lib/convex";
import { z } from "zod";

const WaitlistDeleteSchema = z.object({
  ids: z.preprocess((val) => {
    const arr = z.array(z.union([z.string(), z.number()])).parse(val);
    return arr.map((id) => String(id));
  }, z.array(z.string()).nonempty()),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  let user = null;
  try {
    user = await currentUser();
  } catch (e) {
    console.error("Auth error:", e);
    return NextResponse.json({ error: "Authentication error" }, { status: 401 });
  }

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = WaitlistDeleteSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.message || "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { ids } = parsed.data;
    const convex = getConvexClient();
    const result = await convex.mutation(api.waitlist.removeMultipleFromWaitlist, {
      ids: ids as never,
    });

    return NextResponse.json({
      success: true,
      deletedCount: result.count,
    });
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
