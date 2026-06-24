import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { fetchAction } from "convex/nextjs";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  return new ConvexHttpClient(convexUrl);
}

export async function POST() {
  try {
    await requireAdmin();

    const clerkAuth = await auth();
    const userId = clerkAuth.userId;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = await clerkAuth.getToken({ template: "convex" });
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const secret = process.env.CONVEX_SERVER_SHARED_SECRET;
    if (!secret) {
      return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
    }

    const ts = Date.now();
    const msg = `${userId}:admin:${ts}`;
    const { createHmac } = await import("node:crypto");
    const sig = createHmac("sha256", secret).update(msg).digest("hex");

    const convex = getConvexClient();
    convex.setAuth(token);

    await convex.mutation(api.users.syncUser, {});

    const updated = await fetchAction(
      api.users_actions.serverVerifiedSetUserRole,
      { userId, role: "admin", ts, sig },
      { token, url: process.env.NEXT_PUBLIC_CONVEX_URL }
    );

    return NextResponse.json({ success: true, user: { id: updated._id, role: updated.role } });
  } catch (error) {
    if (error instanceof Error) {
      const msg = (error.message || "").toLowerCase();
      if (msg.includes("unauthorized")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (msg.includes("forbidden") || msg.includes("admin access required")) {
        return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
      }
    }
    console.error("seed-role error:", error);
    return NextResponse.json({ error: "Failed to seed role" }, { status: 500 });
  }
}