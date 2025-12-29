"use client";

import Link from "next/link";
import { Menu } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetClose,
} from "@/components/ui/sheet";

const COURSES_URL = "https://home.huckleberry.art";
const DISCORD_URL = "https://discord.com/invite/4DqDyKZyA8";

export function Header(): React.JSX.Element {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur-md supports-[backdrop-filter]:bg-background/85">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link href="/" className="flex items-center space-x-2">
          <span className="text-xl font-bold text-foreground drop-shadow-sm">
            Huckleberry Art
          </span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-6">
          <Link
            href="/#how-it-works"
            className="text-sm font-medium text-foreground/90 transition-colors hover:text-foreground drop-shadow-sm"
          >
            How it works
          </Link>
          <Link
            href="/#testimonials"
            className="text-sm font-medium text-foreground/90 transition-colors hover:text-foreground drop-shadow-sm"
          >
            Testimonials
          </Link>
          <a
            href={COURSES_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Courses (opens in a new window)"
            className="text-sm font-medium text-foreground/90 transition-colors hover:text-foreground drop-shadow-sm"
          >
            Courses
          </a>
          <a
            href={DISCORD_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Discord (opens in a new window)"
            className="text-sm font-medium text-foreground/90 transition-colors hover:text-foreground drop-shadow-sm"
          >
            Discord
          </a>

          <Button asChild size="sm" className="vibrant-gradient-button transition-all">
            <Link href="/instructors">Browse Instructors</Link>
          </Button>
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
            <div className="flex flex-col gap-6 mt-6">
              <SheetClose asChild>
                <Link
                  href="/#how-it-works"
                  className="text-lg font-medium text-foreground transition-colors hover:text-foreground"
                >
                  How it works
                </Link>
              </SheetClose>
              <SheetClose asChild>
                <Link
                  href="/#testimonials"
                  className="text-lg font-medium text-foreground transition-colors hover:text-foreground"
                >
                  Testimonials
                </Link>
              </SheetClose>
              <SheetClose asChild>
                <a
                  href={COURSES_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Courses (opens in a new window)"
                  className="text-lg font-medium text-foreground transition-colors hover:text-foreground"
                >
                  Courses
                </a>
              </SheetClose>
              <SheetClose asChild>
                <a
                  href={DISCORD_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Discord (opens in a new window)"
                  className="text-lg font-medium text-foreground transition-colors hover:text-foreground"
                >
                  Discord
                </a>
              </SheetClose>
              
              <div className="pt-4 border-t">
                <SheetClose asChild>
                  <Button asChild size="sm" className="vibrant-gradient-button transition-all w-full">
                    <Link href="/instructors">Browse Instructors</Link>
                  </Button>
                </SheetClose>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
