"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, ArrowLeft } from "lucide-react";
import { Form, FormField } from "@/components/form";
import { waitlistFormSchema, WaitlistFormInput } from "@/lib/validators";
import { z } from "zod";

const waitlistResponseSchema = z.object({
  success: z.boolean().optional(),
  message: z.string().optional(),
  error: z.string().optional(),
});

function WaitlistPageContent(): React.JSX.Element {
  const searchParams = useSearchParams();
  const instructorSlug = searchParams.get("instructor");
  const typeParam = searchParams.get("type");
  const type: "one-on-one" | "group" | null = (() => {
    if (typeParam === "one-on-one" || typeParam === "group") {
      return typeParam;
    }
    return null;
  })();

  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(data: WaitlistFormInput) {
    setError("");
    if (!instructorSlug || !type) {
      setError("Instructor and type are required");
      return;
    }

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: data.email,
          instructorSlug,
          type,
        }),
      });

      const rawResult = await response.json();
      const parsed = waitlistResponseSchema.safeParse(rawResult);

      if (!parsed.success) {
        throw new Error("Invalid response from server");
      }

      const result = parsed.data;

      if (!response.ok) {
        throw new Error(result.error || "Failed to join waitlist");
      }

      setIsSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    }
  }

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
            <Form<WaitlistFormInput>
              defaultValues={{ email: "" }}
              validator={{ onChange: waitlistFormSchema }}
              onSubmit={handleSubmit}
            >
              {(form) => (
                <div className="space-y-4">
                  <FormField
                    name="email"
                    label="Email Address"
                    placeholder="your@email.com"
                    type="email"
                    validator={{ onChange: waitlistFormSchema.shape.email }}
                  >
                    {(field) => (
                      <input
                        id={field.name}
                        type="email"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                        placeholder="your@email.com"
                        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                        disabled={form.state.isSubmitting}
                      />
                    )}
                  </FormField>

                  {error && (
                    <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                      {error}
                    </div>
                  )}

                  <Button
                    type="submit"
                    size="lg"
                    className="w-full"
                    disabled={form.state.isSubmitting}
                  >
                    {form.state.isSubmitting ? "Joining..." : "Join Waitlist"}
                  </Button>

                  <p className="text-xs text-muted-foreground text-center">
                    By joining, you agree to receive email notifications about mentorship
                    availability. You can unsubscribe at any time.
                  </p>
                </div>
              )}
            </Form>
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
