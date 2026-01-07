import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function isPublicRoute(pathname: string): boolean {
  return pathname.startsWith("/admin/signin");
}

export default clerkMiddleware(async (auth, request): Promise<NextResponse | undefined> => {
  const pathname = request.nextUrl.pathname;

  if (pathname.startsWith("/api/webhooks")) {
    return NextResponse.next();
  }

  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
