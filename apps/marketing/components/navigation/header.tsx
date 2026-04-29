"use client";

import Link from "next/link";
import Image from "next/image";
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

const COURSES_URL = process.env.NEXT_PUBLIC_COURSES_URL || ("https://home.huckleberry.art/store" as const);
const MENTORSHIPS_URL = process.env.NEXT_PUBLIC_MENTORSHIPS_URL || ("https://mentorships.huckleberry.art" as const);
const DISCORD_URL = process.env.NEXT_PUBLIC_DISCORD_URL || ("https://discord.com/invite/4DqDyKZyA8" as const);
const LOGIN_URL = process.env.NEXT_PUBLIC_LOGIN_URL || ("https://home.huckleberry.art/login" as const);

export function Header(): React.JSX.Element {
  return (
    <header className="sticky top-0 z-50 w-full bg-background border-b border-border">
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
          <a
            href={COURSES_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Courses (opens in a new window)"
            className="text-sm font-medium tracking-wide uppercase text-muted-foreground hover:text-white transition-colors"
          >
            Courses
          </a>
          <a
            href={MENTORSHIPS_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Mentorships (opens in a new window)"
            className="text-sm font-medium tracking-wide uppercase text-muted-foreground hover:text-white transition-colors"
          >
            Mentorships
          </a>
          <a
            href={DISCORD_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Discord (opens in a new window)"
            className="text-sm font-medium tracking-wide uppercase text-muted-foreground hover:text-white transition-colors"
          >
            Discord
          </a>
          <a
            href={LOGIN_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Log In (opens in a new window)"
            className="text-sm font-medium tracking-wide uppercase text-muted-foreground hover:text-white transition-colors"
          >
            Log In
          </a>
        </nav>

        {/* Mobile Navigation */}
        <Sheet>
          <SheetTrigger asChild className="md:hidden ml-auto">
            <Button variant="ghost" size="icon" aria-label="Open menu" className="text-white hover:bg-white/10">
              <Menu className="h-6 w-6" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-[300px] sm:w-[400px] bg-background border-border">
            <SheetHeader>
              <SheetTitle className="text-white">Menu</SheetTitle>
            </SheetHeader>
            <div className="flex flex-col gap-6 mt-8">
              <SheetClose asChild>
                <a
                  href={COURSES_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Courses (opens in a new window)"
                  className="text-base font-medium tracking-wide uppercase text-muted-foreground transition-colors hover:text-white"
                >
                  Courses
                </a>
              </SheetClose>
              <SheetClose asChild>
                <a
                  href={MENTORSHIPS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Mentorships (opens in a new window)"
                  className="text-base font-medium tracking-wide uppercase text-muted-foreground transition-colors hover:text-white"
                >
                  Mentorships
                </a>
              </SheetClose>
              <SheetClose asChild>
                <a
                  href={DISCORD_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Discord (opens in a new window)"
                  className="text-base font-medium tracking-wide uppercase text-muted-foreground transition-colors hover:text-white"
                >
                  Discord
                </a>
              </SheetClose>

              <div className="pt-4 border-t border-border">
                <SheetClose asChild>
                  <a
                    href={LOGIN_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Log In (opens in a new window)"
                    className="text-base font-medium tracking-wide uppercase text-muted-foreground transition-colors hover:text-white"
                  >
                    Log In
                  </a>
                </SheetClose>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
