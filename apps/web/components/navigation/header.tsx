"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
  variant?: "default" | "dark";
}

const defaultNavLinks = [
  { href: "#instructors", label: "Instructors", external: false },
  { href: "#find-match", label: "Find Match", external: false },
];

const previewNavLinks = [
  { href: "#instructors", label: "Mentorships", external: false },
  { href: "https://home.huckleberry.art/store", label: "Courses", external: true },
  { href: "https://discord.gg/4DqDyKZyA8", label: "Discord", external: true },
];

const darkNavLinks = [
  { href: "#instructors", label: "Mentorships", external: false },
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
            <UserButton />
          </SignedIn>
        </>
      );
    },
  }))
);

const PreviewClerkAuthButtons = lazy(() =>
  import("@clerk/nextjs").then((clerk) => ({
    default: function PreviewClerkAuthButtons() {
      const { SignedIn, SignedOut, UserButton } = clerk;
      return (
        <>
          <SignedOut>
            <Button asChild variant="ghost" size="sm" className="text-[#1a1a2e]/70 hover:text-[#1a1a2e] hover:bg-[#1a1a2e]/5">
              <Link href="/sign-in">Sign In</Link>
            </Button>
            <Button asChild size="sm" className="bg-[#7c3aed] hover:bg-[#6d28d9] text-white transition-all">
              <Link href="/sign-up">Get Started</Link>
            </Button>
          </SignedOut>
          <SignedIn>
            <Button asChild variant="ghost" size="sm" className="text-[#1a1a2e]/70 hover:text-[#1a1a2e] hover:bg-[#1a1a2e]/5">
              <Link href="/dashboard">Dashboard</Link>
            </Button>
            <UserButton />
          </SignedIn>
        </>
      );
    },
  }))
);

const DarkClerkAuthButtons = lazy(() =>
  import("@clerk/nextjs").then((clerk) => ({
    default: function DarkClerkAuthButtons() {
      const { SignedIn, SignedOut, UserButton } = clerk;
      return (
        <>
          <SignedOut>
            <Button asChild variant="ghost" size="sm" className="text-white/80 hover:bg-white/10 hover:text-white">
              <Link href="/sign-in">Sign In</Link>
            </Button>
            <Button asChild size="sm" className="vibrant-gradient-button transition-all">
              <Link href="/sign-up">Get Started</Link>
            </Button>
          </SignedOut>
          <SignedIn>
            <Button asChild variant="ghost" size="sm" className="text-white/80 hover:bg-white/10 hover:text-white">
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
              <UserButton />
            </div>
          </SignedIn>
        </>
      );
    },
  }))
);

const PreviewMobileClerkAuthButtons = lazy(() =>
  import("@clerk/nextjs").then((clerk) => ({
    default: function PreviewMobileClerkAuthButtons(): ReactElement {
      const { SignedIn, SignedOut, UserButton } = clerk;
      return (
        <>
          <SignedOut>
            <Button asChild variant="ghost" size="sm" className="text-[#1a1a2e]/70 hover:text-[#1a1a2e] w-full justify-start">
              <Link href="/sign-in">Sign In</Link>
            </Button>
            <Button asChild size="sm" className="bg-[#7c3aed] hover:bg-[#6d28d9] text-white transition-all w-full">
              <Link href="/sign-up">Get Started</Link>
            </Button>
          </SignedOut>
          <SignedIn>
            <Button asChild variant="ghost" size="sm" className="text-[#1a1a2e]/70 hover:text-[#1a1a2e] w-full justify-start">
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

const DarkMobileClerkAuthButtons = lazy(() =>
  import("@clerk/nextjs").then((clerk) => ({
    default: function DarkMobileClerkAuthButtons(): ReactElement {
      const { SignedIn, SignedOut, UserButton } = clerk;
      return (
        <>
          <SignedOut>
            <Button asChild variant="ghost" size="sm" className="text-white/80 hover:bg-white/10 hover:text-white w-full justify-start">
              <Link href="/sign-in">Sign In</Link>
            </Button>
            <Button asChild size="sm" className="vibrant-gradient-button transition-all w-full">
              <Link href="/sign-up">Get Started</Link>
            </Button>
          </SignedOut>
          <SignedIn>
            <Button asChild variant="ghost" size="sm" className="text-white/80 hover:bg-white/10 hover:text-white w-full justify-start">
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

function FallbackAuthButtons({ isDark = false, isPreview = false }: { isDark?: boolean; isPreview?: boolean }): ReactElement {
  const ghostClass = isDark ? "text-white/80 hover:bg-white/10 hover:text-white" : isPreview ? "text-[#1a1a2e]/70 hover:text-[#1a1a2e] hover:bg-[#1a1a2e]/5" : "";
  const ctaClass = isPreview ? "bg-[#7c3aed] hover:bg-[#6d28d9] text-white transition-all" : "vibrant-gradient-button transition-all";
  return (
    <>
      <Button asChild variant="ghost" size="sm" className={ghostClass}>
        <Link href="/sign-in">Sign In</Link>
      </Button>
      <Button asChild size="sm" className={ctaClass}>
        <Link href="/sign-up">Get Started</Link>
      </Button>
    </>
  );
}

function FallbackMobileAuthButtons({ isDark = false, isPreview = false }: { isDark?: boolean; isPreview?: boolean }): ReactElement {
  const ghostClass = isDark ? "text-white/80 hover:bg-white/10 hover:text-white w-full justify-start" : isPreview ? "text-[#1a1a2e]/70 hover:text-[#1a1a2e] w-full justify-start" : "w-full justify-start";
  const ctaClass = isPreview ? "bg-[#7c3aed] hover:bg-[#6d28d9] text-white transition-all w-full" : "vibrant-gradient-button transition-all w-full";
  return (
    <div className="flex flex-col gap-4">
      <Button asChild variant="ghost" size="sm" className={ghostClass}>
        <Link href="/sign-in">Sign In</Link>
      </Button>
      <Button asChild size="sm" className={ctaClass}>
        <Link href="/sign-up">Get Started</Link>
      </Button>
    </div>
  );
}

function MobileNavContent({ hasClerk = true, isDark = false, isPreview = false }: { hasClerk?: boolean; isDark?: boolean; isPreview?: boolean }): ReactElement {
  const links = isPreview ? previewNavLinks : isDark ? darkNavLinks : defaultNavLinks;
  const linkClass = isDark
    ? "text-lg font-medium text-white/80 transition-colors hover:text-white"
    : isPreview
    ? "text-lg font-medium text-[#1a1a2e]/70 transition-colors hover:text-[#1a1a2e]"
    : "text-lg font-medium text-foreground transition-colors hover:text-foreground";

  return (
    <div className="flex flex-col gap-6 mt-6">
      {links.map((link) => (
        <SheetClose asChild key={link.href}>
          {link.external ? (
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              {link.label}
            </a>
          ) : (
            <Link href={link.href} className={linkClass}>
              {link.label}
            </Link>
          )}
        </SheetClose>
      ))}

      <div className="flex flex-col gap-4 pt-4 border-t">
        {hasClerk ? (
          <Suspense fallback={<FallbackMobileAuthButtons isDark={isDark} isPreview={isPreview} />}>
            {isDark ? <DarkMobileClerkAuthButtons /> : isPreview ? <PreviewMobileClerkAuthButtons /> : <MobileClerkAuthButtons />}
          </Suspense>
        ) : (
          <FallbackMobileAuthButtons isDark={isDark} isPreview={isPreview} />
        )}
      </div>
    </div>
  );
}

export function Header({ hasClerk = true, variant }: HeaderProps): ReactElement {
  const pathname = usePathname();
  const isPreview = pathname?.startsWith("/preview");
  const isDark = variant === "dark";

  const headerClass = isDark
    ? "sticky top-0 z-50 w-full border-b border-[#2a2d3e] bg-[#0f1117]/95 backdrop-blur-md"
    : isPreview
    ? "sticky top-0 z-50 w-full border-b border-gray-200 bg-white/95 backdrop-blur-md"
    : "sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur-md supports-[backdrop-filter]:bg-background/85";
  const logoClass = isDark
    ? "text-xl font-bold text-white"
    : isPreview
    ? "text-xl font-bold text-[#1a1a2e]"
    : "text-xl font-bold text-foreground drop-shadow-sm";
  const linkClass = isDark
    ? "text-sm font-medium text-white/80 transition-colors hover:text-white"
    : isPreview
    ? "text-sm font-medium text-[#1a1a2e]/70 transition-colors hover:text-[#1a1a2e]"
    : "text-sm font-medium text-foreground/90 transition-colors hover:text-foreground drop-shadow-sm";

  const links = isPreview ? previewNavLinks : isDark ? darkNavLinks : defaultNavLinks;

  return (
    <header className={headerClass}>
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link href="/" className="flex items-center space-x-2">
          <span className={logoClass}>{isDark ? "Huckleberry Art Academy" : "Huckleberry Art"}</span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-6">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={linkClass}
              {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            >
              {link.label}
            </Link>
          ))}

          {hasClerk ? (
            <Suspense fallback={<FallbackAuthButtons isDark={isDark} isPreview={isPreview} />}>
              {isDark ? <DarkClerkAuthButtons /> : isPreview ? <PreviewClerkAuthButtons /> : <ClerkAuthButtons />}
            </Suspense>
          ) : (
            <FallbackAuthButtons isDark={isDark} isPreview={isPreview} />
          )}
        </nav>

        {/* Mobile Navigation */}
        <Sheet>
          <SheetTrigger asChild className="md:hidden">
            <Button variant="ghost" size="icon" aria-label="Open menu" className={isDark ? "text-white/80 hover:bg-white/10" : isPreview ? "text-[#1a1a2e]" : ""}>
              <Menu className="h-6 w-6" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className={isDark ? "bg-[#161822] border-[#2a2d3e] text-white" : ""}>
            <SheetHeader>
              <SheetTitle className={isDark ? "text-white" : ""}>Menu</SheetTitle>
            </SheetHeader>
            <MobileNavContent hasClerk={hasClerk} isDark={isDark} isPreview={isPreview} />
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}