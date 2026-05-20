import { NextRequest, NextResponse } from "next/server";
import { getPlatformBaseUrl } from "@/lib/platform";

// Redirects Web's Google OAuth start to Platform's start endpoint.
// Platform is the source of truth for instructor data and handles
// state cookie + Google redirect. We preserve query params as-is.
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    // Normalize base URL to avoid double slashes when joining path
    const base = getPlatformBaseUrl().replace(/\/+$/, "");
    const search = request.nextUrl.search || "";
    const target = `${base}/api/auth/google${search}`;
    return NextResponse.redirect(target, 302);
  } catch (error) {
    console.error("[web] Google OAuth redirect error:", error);
    return NextResponse.json(
      { error: "Failed to redirect to Platform Google OAuth" },
      { status: 500 }
    );
  }
}
