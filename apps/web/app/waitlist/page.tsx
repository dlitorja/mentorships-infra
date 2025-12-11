"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";

// Force dynamic rendering to prevent static generation issues with useSearchParams
export const dynamic = "force-dynamic";

function WaitlistContent(): React.JSX.Element {
  const searchParams = useSearchParams();
  const instructorSlug = searchParams.get("instructor");
  const type = searchParams.get("type") || "one-on-one";
  
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          instructorSlug,
          type,
          email,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to join waitlist");
      }

      setIsSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">You're on the waitlist!</CardTitle>
            <CardDescription>
              We'll notify you when this instructor has availability.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground text-center">
              You'll receive an email notification as soon as spots become available.
            </p>
            <div className="flex flex-col gap-2">
              <Button asChild className="w-full">
                <Link href={instructorSlug ? `/instructors/${instructorSlug}` : "/instructors"}>
                  Back to Instructor
                </Link>
              </Button>
              <Button asChild variant="outline" className="w-full">
                <Link href="/instructors">Browse All Instructors</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Join Waitlist</CardTitle>
          <CardDescription>
            Get notified when this instructor has availability for {type === "one-on-one" ? "1-on-1" : "group"} mentorship.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium">
                Email Address
              </label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
              />
            </div>

            {error && (
              <div className="p-3 text-sm text-red-600 bg-red-50 rounded-md">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Button
                type="submit"
                size="lg"
                className="w-full vibrant-gradient-button transition-all"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Joining Waitlist..." : "Join Waitlist"}
              </Button>
              <Button asChild variant="outline" className="w-full">
                <Link href={instructorSlug ? `/instructors/${instructorSlug}` : "/instructors"}>
                  Cancel
                </Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function WaitlistPage(): React.JSX.Element {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center px-4">
          <Card className="max-w-md w-full">
            <CardHeader className="text-center">
              <CardTitle className="text-2xl">Loading...</CardTitle>
              <CardDescription>Please wait</CardDescription>
            </CardHeader>
          </Card>
        </div>
      }
    >
      <WaitlistContent />
    </Suspense>
  );
}

