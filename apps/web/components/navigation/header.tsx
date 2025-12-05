import Link from "next/link";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";

export function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between px-4">
        <Link href="/" className="flex items-center space-x-2">
          <span className="text-xl font-bold">Huckleberry Art</span>
        </Link>
        
        <nav className="flex items-center gap-6">
          <Link
            href="#instructors"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Instructors
          </Link>
          <Link
            href="#find-match"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Find Match
          </Link>
          
          <SignedOut>
            <Button asChild variant="ghost" size="sm">
              <Link href="/sign-in">Sign In</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/sign-up">Get Started</Link>
            </Button>
          </SignedOut>
          
          <SignedIn>
            <Button asChild variant="ghost" size="sm">
              <Link href="/dashboard">Dashboard</Link>
            </Button>
            <UserButton afterSignOutUrl="/" />
          </SignedIn>
        </nav>
      </div>
    </header>
  );
}

