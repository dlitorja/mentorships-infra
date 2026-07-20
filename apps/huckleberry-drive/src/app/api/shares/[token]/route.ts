import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireInstructor, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { DEFAULT_SHARE_EXPIRES_IN_DAYS } from "@/lib/shares";

const VALID_EXPIRES_IN_DAYS = new Set([7, 30, 365, 3650]);

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

    let normalizedExpiresAt: number | undefined;
    if (expiresInDays === undefined || expiresInDays === null) {
      normalizedExpiresAt = Date.now() + DEFAULT_SHARE_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000;
    } else if (expiresInDays === "never") {
      normalizedExpiresAt = undefined;
    } else if (typeof expiresInDays === "number") {
      if (!Number.isInteger(expiresInDays) || !VALID_EXPIRES_IN_DAYS.has(expiresInDays)) {
        return NextResponse.json(
          { error: "expiresInDays must be 7, 30, 365, 3650, or the string \"never\"" },
          { status: 400 }
        );
      }
      normalizedExpiresAt = Date.now() + expiresInDays * 24 * 60 * 60 * 1000;
    } else {
      return NextResponse.json(
        { error: "expiresInDays must be a number or \"never\"" },
        { status: 400 }
      );
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
