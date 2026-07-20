import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireInstructor, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { normalizeExpiresInDays } from "@/lib/shares";

interface Params {
  params: Promise<{ token: string }>;
}

export async function DELETE(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    await requireInstructor();
    const { getToken } = await auth();
    const convexToken = await getToken({ template: "convex" }) ?? undefined;
    const { token } = await params;

    if (!token || token.length < 16) {
      return NextResponse.json({ error: "Invalid token" }, { status: 400 });
    }

    await fetchMutation(api.hdShareLinks.revokeShareLink, { token }, { token: convexToken });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Revoke share error:", error);

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

export async function PATCH(request: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    await requireInstructor();
    const { getToken } = await auth();
    const convexToken = await getToken({ template: "convex" }) ?? undefined;
    const { token } = await params;

    if (!token || token.length < 16) {
      return NextResponse.json({ error: "Invalid token" }, { status: 400 });
    }

    const body = await request.json();
    const { expiresInDays } = body;

    const { expiresAt: normalizedExpiresAt, error: expiryError } =
      normalizeExpiresInDays(expiresInDays);
    if (expiryError) {
      return NextResponse.json({ error: expiryError }, { status: 400 });
    }

    const result = await fetchMutation(
      api.hdShareLinks.extendShareLink,
      { token, expiresAt: normalizedExpiresAt },
      { token: convexToken }
    );

    return NextResponse.json({
      success: true,
      shareId: result.shareId,
      expiresAt: result.expiresAt,
    });
  } catch (error) {
    console.error("Extend share error:", error);

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
