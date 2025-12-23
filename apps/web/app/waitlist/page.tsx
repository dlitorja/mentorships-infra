"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import { waitlistFormSchema } from "@/lib/validation-schemas";
import { joinWaitlist } from "@/lib/queries/api-client";

// Force dynamic rendering to prevent static generation issues with useSearchParams
export const dynamic = "force-dynamic";

function WaitlistContent(): React.JSX.Element {
  const searchParams = useSearchParams();
  const instructorSlug = searchParams.get("instructor");
  const type = searchParams.get("type") || "one-on-one";

  // Join waitlist mutation
  const joinWaitlistMutation = useMutation({
    mutationFn: (data: { email: string; instructorSlug?: string; type?: string }) =>
      joinWaitlist(data),
    onSuccess: () => {
      form.reset();
    },
  });

  const form = useForm({
    defaultValues: {
      email: "",
    },
    validators: {
      onChange: waitlistFormSchema,
    },
    onSubmit: async ({ value }) => {
      joinWaitlistMutation.mutate({
        email: value.email,
        instructorSlug: instructorSlug || undefined,
        type,
      });
    },
  });

  const isSuccess = joinWaitlistMutation.isSuccess;
  const error =
    joinWaitlistMutation.error instanceof Error
      ? joinWaitlistMutation.error.message
      : null;

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
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
            className="space-y-4"
          >
            <form.Field
              name="email"
              validators={{
                onChange: waitlistFormSchema.shape.email,
              }}
            >
              {(field) => (
                <div className="space-y-2">
                  <label htmlFor={field.name} className="text-sm font-medium">
                    Email Address
                  </label>
                  <Input
                    id={field.name}
                    type="email"
                    name={field.name}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    placeholder="your@email.com"
                    aria-invalid={field.state.meta.errors.length > 0}
                    aria-describedby={
                      field.state.meta.errors.length > 0
                        ? `${field.name}-error`
                        : undefined
                    }
                  />
                  {field.state.meta.errors.length > 0 && (
                    <p
                      id={`${field.name}-error`}
                      className="text-sm text-red-600 dark:text-red-400"
                    >
                      {field.state.meta.errors[0]?.message}
                    </p>
                  )}
                </div>
              )}
            </form.Field>

            {error && (
              <div className="p-3 text-sm text-red-600 bg-red-50 dark:bg-red-950 dark:text-red-400 rounded-md">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Button
                type="submit"
                size="lg"
                className="w-full vibrant-gradient-button transition-all"
                disabled={form.state.isSubmitting || joinWaitlistMutation.isPending}
              >
                {form.state.isSubmitting || joinWaitlistMutation.isPending
                  ? "Joining Waitlist..."
                  : "Join Waitlist"}
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
              <CardTitle className="text-2xl">Join Waitlist</CardTitle>
              <CardDescription>Loading...</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-muted-foreground">
                Loading waitlist form...
              </div>
            </CardContent>
          </Card>
        </div>
      }
    >
      <WaitlistContent />
    </Suspense>
  );
}

