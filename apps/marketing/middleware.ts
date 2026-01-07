import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function isPublicRoute(pathname: string): boolean {
  return (
    pathname.startsWith("/admin/signin") ||
    pathname.startsWith("/api/webhooks") ||
    pathname.startsWith("/api/admin") ||
    pathname.startsWith("/api/contacts") ||
    pathname.startsWith("/api/waitlist")
  );
}

export default clerkMiddleware(async (auth, request) => {
  const pathname = request.nextUrl.pathname;

  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
