"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Suspense, lazy } from "react";
import type { ReactElement } from "react";
import { Menu } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetClose,
} from "@/components/ui/sheet";

interface HeaderProps {
  hasClerk?: boolean;
}

// Dynamically import Clerk components only when needed
const ClerkAuthButtons = lazy(() =>
  import("@clerk/nextjs").then((clerk) => ({
    default: function ClerkAuthButtons() {
      const { SignedIn, SignedOut, UserButton } = clerk;
      return (
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
      );
    },
  }))
);

function FallbackAuthButtons() {
  return (
    <>
      <Button asChild variant="ghost" size="sm">
        <Link href="/sign-in">Sign In</Link>
      </Button>
      <Button asChild size="sm" className="vibrant-gradient-button transition-all">
        <Link href="/sign-up">Get Started</Link>
      </Button>
    </>
  );
}

// Mobile-specific auth buttons component
const MobileClerkAuthButtons = lazy(() =>
  import("@clerk/nextjs").then((clerk) => ({
    default: function MobileClerkAuthButtons(): ReactElement {
      const { SignedIn, SignedOut, UserButton } = clerk;
      return (
        <>
          <SignedOut>
            <Button asChild variant="ghost" size="sm" className="w-full justify-start">
              <Link href="/sign-in">Sign In</Link>
            </Button>
            <Button asChild size="sm" className="vibrant-gradient-button transition-all w-full">
              <Link href="/sign-up">Get Started</Link>
            </Button>
          </SignedOut>
          
          <SignedIn>
            <Button asChild variant="ghost" size="sm" className="w-full justify-start">
              <Link href="/dashboard">Dashboard</Link>
            </Button>
            <div className="flex items-center justify-start">
              <UserButton afterSignOutUrl="/" />
            </div>
          </SignedIn>
        </>
      );
    },
  }))
);

function MobileNavContent({ hasClerk = true }: { hasClerk?: boolean }): ReactElement {
  return (
    <div className="flex flex-col gap-6 mt-6">
      <SheetClose asChild>
        <Link
          href="#instructors"
          className="text-lg font-medium text-foreground transition-colors hover:text-foreground"
        >
          Instructors
        </Link>
      </SheetClose>
      <SheetClose asChild>
        <Link
          href="#find-match"
          className="text-lg font-medium text-foreground transition-colors hover:text-foreground"
        >
          Find Match
        </Link>
      </SheetClose>
      
      <div className="flex flex-col gap-4 pt-4 border-t">
        {hasClerk ? (
          <Suspense fallback={
            <div className="flex flex-col gap-4">
              <Button asChild variant="ghost" size="sm" className="w-full justify-start">
                <Link href="/sign-in">Sign In</Link>
              </Button>
              <Button asChild size="sm" className="vibrant-gradient-button transition-all w-full">
                <Link href="/sign-up">Get Started</Link>
              </Button>
            </div>
          }>
            <MobileClerkAuthButtons />
          </Suspense>
        ) : (
          <div className="flex flex-col gap-4">
            <Button asChild variant="ghost" size="sm" className="w-full justify-start">
              <Link href="/sign-in">Sign In</Link>
            </Button>
            <Button asChild size="sm" className="vibrant-gradient-button transition-all w-full">
              <Link href="/sign-up">Get Started</Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export function Header({ hasClerk = true }: HeaderProps): ReactElement {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur-md supports-[backdrop-filter]:bg-background/85">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link href="/" className="flex items-center space-x-2">
          <span className="text-xl font-bold text-foreground drop-shadow-sm">Huckleberry Art</span>
        </Link>
        
        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-6">
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
          
          {hasClerk ? (
            <Suspense fallback={<FallbackAuthButtons />}>
              <ClerkAuthButtons />
            </Suspense>
          ) : (
            <FallbackAuthButtons />
          )}
        </nav>

        {/* Mobile Navigation */}
        <Sheet>
          <SheetTrigger asChild className="md:hidden">
            <Button variant="ghost" size="icon" aria-label="Open menu">
              <Menu className="h-6 w-6" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-[300px] sm:w-[400px]">
            <SheetHeader>
              <SheetTitle>Menu</SheetTitle>
            </SheetHeader>
            <MobileNavContent hasClerk={hasClerk} />
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}

