"use client";

import Link from "next/link";
import Image from "next/image";
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

const navLinks = [
  { href: "/instructors", label: "Instructors", external: false },
  { href: "https://home.huckleberry.art/store", label: "Courses", external: true },
  { href: "https://discord.gg/4DqDyKZyA8", label: "Discord", external: true },
];

const ClerkAuthButtons = lazy(() =>
  import("@clerk/nextjs").then((clerk) => ({
    default: function ClerkAuthButtons() {
      const { SignedIn, SignedOut, UserButton } = clerk;
      return (
        <>
          <SignedOut>
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-white hover:bg-white/10 uppercase tracking-wide text-xs">
              <Link href="/sign-in">Sign In</Link>
            </Button>
            <Button asChild size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90 uppercase tracking-wide text-xs font-semibold">
              <Link href="/sign-up">Get Started</Link>
            </Button>
          </SignedOut>
          <SignedIn>
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-white hover:bg-white/10 uppercase tracking-wide text-xs">
              <Link href="/dashboard">Dashboard</Link>
            </Button>
            <UserButton />
          </SignedIn>
        </>
      );
    },
  }))
);

const MobileClerkAuthButtons = lazy(() =>
  import("@clerk/nextjs").then((clerk) => ({
    default: function MobileClerkAuthButtons(): ReactElement {
      const { SignedIn, SignedOut, UserButton } = clerk;
      return (
        <>
          <SignedOut>
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-white w-full justify-start uppercase tracking-wide">
              <Link href="/sign-in">Sign In</Link>
            </Button>
            <Button asChild size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90 w-full uppercase tracking-wide font-semibold">
              <Link href="/sign-up">Get Started</Link>
            </Button>
          </SignedOut>
          <SignedIn>
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-white w-full justify-start uppercase tracking-wide">
              <Link href="/dashboard">Dashboard</Link>
            </Button>
            <div className="flex items-center justify-start">
              <UserButton />
            </div>
          </SignedIn>
        </>
      );
    },
  }))
);

function FallbackAuthButtons(): ReactElement {
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-white hover:bg-white/10 uppercase tracking-wide text-xs">
        <Link href="/sign-in">Sign In</Link>
      </Button>
      <Button asChild size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90 uppercase tracking-wide text-xs font-semibold">
        <Link href="/sign-up">Get Started</Link>
      </Button>
    </>
  );
}

function FallbackMobileAuthButtons(): ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-white w-full justify-start uppercase tracking-wide">
        <Link href="/sign-in">Sign In</Link>
      </Button>
      <Button asChild size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90 w-full uppercase tracking-wide font-semibold">
        <Link href="/sign-up">Get Started</Link>
      </Button>
    </div>
  );
}

function MobileNavContent({ hasClerk = true }: { hasClerk?: boolean }): ReactElement {
  return (
    <div className="flex flex-col gap-6 mt-8">
      {navLinks.map((link) => (
        <SheetClose asChild key={link.href}>
          {link.external ? (
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-base font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-white"
            >
              {link.label}
            </a>
          ) : (
            <Link href={link.href} className="text-base font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-white">
              {link.label}
            </Link>
          )}
        </SheetClose>
      ))}

      <div className="flex flex-col gap-4 pt-4 border-t border-border">
        {hasClerk ? (
          <Suspense fallback={<FallbackMobileAuthButtons />}>
            <MobileClerkAuthButtons />
          </Suspense>
        ) : (
          <FallbackMobileAuthButtons />
        )}
      </div>
    </div>
  );
}

export function Header({ hasClerk = true }: HeaderProps): ReactElement {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background">
      <div className="container mx-auto flex h-16 md:h-20 items-center justify-between px-4 md:px-10">
        <Link href="/" className="flex items-center">
          <div className="h-11 relative" style={{ width: '79px' }}>
            <Image
              src="/logo_bad2.png"
              alt="Huckleberry Art"
              fill
              style={{ objectFit: 'contain' }}
              className="brightness-0 invert"
              priority
            />
          </div>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-8">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-white"
              {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            >
              {link.label}
            </Link>
          ))}

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
            <Button variant="ghost" size="icon" aria-label="Open menu" className="text-white hover:bg-white/10">
              <Menu className="h-6 w-6" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="bg-background border-border">
            <SheetHeader>
              <SheetTitle className="text-white">Menu</SheetTitle>
            </SheetHeader>
            <MobileNavContent hasClerk={hasClerk} />
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
