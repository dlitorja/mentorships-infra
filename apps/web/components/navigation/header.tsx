"use client";

import Link from "next/link";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";

export function Header() {
  const hasClerkKey = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && 
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY !== "pk_test_placeholder_for_build_time_only";

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur-md supports-[backdrop-filter]:bg-background/85">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link href="/" className="flex items-center space-x-2">
          <span className="text-xl font-bold text-foreground drop-shadow-sm">Huckleberry Art</span>
        </Link>
        
        <nav className="flex items-center gap-6">
          <Link
            href="#instructors"
            className="text-sm font-medium text-foreground/90 transition-colors hover:text-foreground drop-shadow-sm"
          >
            Instructors
          </Link>
          <Link
            href="#find-match"
            className="text-sm font-medium text-foreground/90 transition-colors hover:text-foreground drop-shadow-sm"
          >
            Find Match
          </Link>
          
          {hasClerkKey ? (
            <>
              <SignedOut>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/sign-in">Sign In</Link>
                </Button>
                <Button asChild size="sm" className="vibrant-gradient-button transition-all">
                  <Link href="/sign-up">Get Started</Link>
                </Button>
              </SignedOut>
              
              <SignedIn>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/dashboard">Dashboard</Link>
                </Button>
                <UserButton afterSignOutUrl="/" />
              </SignedIn>
            </>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/sign-in">Sign In</Link>
              </Button>
              <Button asChild size="sm" className="vibrant-gradient-button transition-all">
                <Link href="/sign-up">Get Started</Link>
              </Button>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

