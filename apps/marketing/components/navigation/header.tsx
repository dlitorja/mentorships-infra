import Link from "next/link";

import { Button } from "@/components/ui/button";

export function Header(): React.JSX.Element {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur-md supports-[backdrop-filter]:bg-background/85">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link href="/" className="flex items-center space-x-2">
          <span className="text-xl font-bold text-foreground drop-shadow-sm">
            Huckleberry Art
          </span>
        </Link>

        <nav className="flex items-center gap-6">
          <Link
            href="/instructors"
            className="text-sm font-medium text-foreground/90 transition-colors hover:text-foreground drop-shadow-sm"
          >
            Instructors
          </Link>
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

          <Button asChild size="sm" className="vibrant-gradient-button transition-all">
            <Link href="/instructors">Browse Instructors</Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}
