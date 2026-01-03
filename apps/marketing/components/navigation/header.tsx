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

const COURSES_URL = "https://home.huckleberry.art/store" as const;
const MENTORSHIPS_URL = "https://mentorships.huckleberry.art" as const;
const DISCORD_URL = "https://discord.com/invite/4DqDyKZyA8" as const;
const LOGIN_URL = "https://home.huckleberry.art/login" as const;

export function Header(): React.JSX.Element {
  return (
    <header className="sticky top-0 z-50 w-full bg-white">
      <div className="container mx-auto flex h-16 md:h-20 items-center px-4 md:px-10">
        <Link href="/" className="flex items-center">
          <Image
            src="/logo_bad2_gray.png"
            alt="Huckleberry Art"
            width={100}
            height={56}
            className="h-11 w-auto"
            priority
          />
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-5 ml-auto">
          <a
            href={COURSES_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Courses (opens in a new window)"
            className="text-base font-normal text-[#595959] hover:text-black transition-colors"
          >
            Courses
          </a>
          <a
            href={MENTORSHIPS_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Mentorships (opens in a new window)"
            className="text-base font-normal text-[#595959] hover:text-black transition-colors"
          >
            Mentorships
          </a>
          <a
            href={DISCORD_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Discord (opens in a new window)"
            className="text-base font-normal text-[#595959] hover:text-black transition-colors"
          >
            Discord
          </a>
          <Link href={LOGIN_URL} className="text-base font-normal text-[#595959] hover:text-black transition-colors ml-2">
            Log In
          </Link>
        </nav>

        {/* Mobile Navigation */}
        <Sheet>
          <SheetTrigger asChild className="md:hidden">
            <Button variant="ghost" size="icon" aria-label="Open menu">
              <Menu className="h-6 w-6 text-black" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-[300px] sm:w-[400px]">
            <SheetHeader>
              <SheetTitle>Menu</SheetTitle>
            </SheetHeader>
            <div className="flex flex-col gap-6 mt-6">
              <SheetClose asChild>
                <a
                  href={COURSES_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Courses (opens in a new window)"
                  className="text-base font-normal text-[#595959] transition-colors hover:text-black"
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
                  className="text-base font-normal text-[#595959] transition-colors hover:text-black"
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
                  className="text-base font-normal text-[#595959] transition-colors hover:text-black"
                >
                  Discord
                </a>
              </SheetClose>

              <div className="pt-4 border-t">
                <SheetClose asChild>
                  <Link href={LOGIN_URL} className="text-base font-normal text-[#595959] transition-colors hover:text-black">
                    Log In
                  </Link>
                </SheetClose>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
