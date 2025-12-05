import Link from "next/link";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <div className="z-10 max-w-5xl w-full items-center justify-between font-mono text-sm">
        <h1 className="text-4xl font-bold mb-8">Mentorship Platform</h1>
        
        <div className="flex items-center gap-4 mb-8">
          <SignedOut>
            <Link
              href="/sign-in"
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Sign In
            </Link>
            <Link
              href="/sign-up"
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
            >
              Sign Up
            </Link>
          </SignedOut>
          
          <SignedIn>
            <Link
              href="/dashboard"
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Go to Dashboard
            </Link>
            <UserButton afterSignOutUrl="/" />
          </SignedIn>
        </div>

        <div className="text-center">
          <p className="text-lg mb-4">
            Connect with expert mentors and accelerate your growth
          </p>
          <Link
            href="/mentors"
            className="text-blue-600 hover:underline"
          >
            Browse Mentors →
          </Link>
        </div>
      </div>
    </main>
  );
}

