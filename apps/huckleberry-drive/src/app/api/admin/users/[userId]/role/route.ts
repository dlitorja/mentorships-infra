import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { z } from "zod";

const RoleUpdateSchema = z.object({
  role: z.enum(["student", "instructor", "admin", "video_editor"]),
});

interface Params {
  params: Promise<{ userId: string }>;
}

export async function PATCH(
  request: NextRequest,
  { params }: Params
): Promise<NextResponse> {
  try {
    const { userId } = await params;
    await requireAdmin();
    const { getToken } = await auth();
    const convexToken = await getToken({ template: "convex" }) ?? undefined;

    const body = await request.json();
    const parsed = RoleUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid role", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const result = await fetchMutation(api.users.updateUserRole, {
      userId,
      role: parsed.data.role,
    }, { token: convexToken });

    return NextResponse.json({ success: true, user: result });
  } catch (error) {
    console.error("Update user role error:", error);

    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}