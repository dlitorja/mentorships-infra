"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle2, ArrowLeft } from "lucide-react";
import { Suspense } from "react";

function WaitlistPageContent(): React.JSX.Element {
  const searchParams = useSearchParams();
  const instructorSlug = searchParams.get("instructor");
  const type = searchParams.get("type") as "one-on-one" | "group" | null;

  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError("");

    try {
      if (!instructorSlug || !type) {
        throw new Error("Instructor and type are required");
      }

      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          instructorSlug,
          type,
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
      <div className="min-h-screen bg-background py-12 px-4">
        <div className="container mx-auto max-w-2xl">
          <Link
            href={instructorSlug ? `/instructors/${instructorSlug}` : "/instructors"}
            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-8"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to {instructorSlug ? "instructor" : "instructors"}
          </Link>

          <Card className="text-center">
            <CardHeader>
              <div className="flex justify-center mb-4">
                <CheckCircle2 className="h-16 w-16 text-green-500" />
              </div>
              <CardTitle className="text-3xl">You're on Waitlist!</CardTitle>
              <CardDescription className="text-lg">
                We'll notify you when spots become available.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground mb-6">
                You've been added to waitlist for{" "}
                {instructorSlug && (
                  <Link
                    href={`/instructors/${instructorSlug}`}
                    className="text-primary hover:underline font-medium"
                  >
                    this instructor
                  </Link>
                )}
                . When new spots open up, we'll send you an email with all the details.
              </p>
              <Button asChild variant="outline" size="lg">
                <Link href="/instructors">Browse All Instructors</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background py-12 px-4">
      <div className="container mx-auto max-w-2xl">
        <Link
          href={instructorSlug ? `/instructors/${instructorSlug}` : "/instructors"}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-8"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to {instructorSlug ? "instructor" : "instructors"}
        </Link>

        <Card>
          <CardHeader>
            <CardTitle className="text-3xl">Join Waitlist</CardTitle>
            <CardDescription>
              {instructorSlug && type ? (
                <>
                  Join waitlist for{" "}
                  <span className="font-medium">
                    {type === "one-on-one" ? "One-on-One" : "Group"} Mentorship
                  </span>
                </>
              ) : (
                "Get notified when new mentorship spots become available"
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={isSubmitting}
                />
              </div>

              {error && (
                <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                  {error}
                </div>
              )}

              <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? "Joining..." : "Join Waitlist"}
              </Button>

              <p className="text-xs text-muted-foreground text-center">
                By joining, you agree to receive email notifications about mentorship
                availability. You can unsubscribe at any time.
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function WaitlistPage(): React.JSX.Element {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center">Loading...</div>}>
      <WaitlistPageContent />
    </Suspense>
  );
}
