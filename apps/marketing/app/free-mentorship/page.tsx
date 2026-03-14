"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { z } from "zod";
import { getInstructorsWithFreeMentorship, type Instructor } from "@/lib/instructors";

const nameSchema = z.string().min(1, "Please enter your name");
const emailSchema = z.string().email("Please enter a valid email address");
const timeZoneSchema = z.string().min(1, "Please select your time zone");
const artGoalsSchema = z.string().min(1, "Please describe what you'd like to improve");
const instructorSchema = z.string().min(1, "Please select an instructor");
const consentSchema = z
  .boolean()
  .refine((val) => val === true, "You must agree to the terms to sign up");

export const dynamic = "force-dynamic";

function getTimeZones(): string[] {
  const fn = (Intl as unknown as { supportedValuesOf?: (key: "timeZone") => string[] })
    .supportedValuesOf;
  if (typeof fn === "function") {
    try {
      return fn("timeZone");
    } catch {
      // ignore
    }
  }
  return ["UTC", "America/Los_Angeles", "America/New_York", "Europe/London", "Europe/Berlin"];
}

async function submitFreeMentorship(data: {
  name: string;
  email: string;
  portfolioUrl?: string;
  timeZone: string;
  artGoals: string;
  instructorSlug: string;
  consent: boolean;
}) {
  const response = await fetch("/api/free-mentorship", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error || "Failed to submit");
  }

  return response.json();
}

function FreeMentorshipContent(): React.JSX.Element {
  const searchParams = useSearchParams();
  const instructorParam = searchParams.get("instructor");

  const instructors = getInstructorsWithFreeMentorship();
  const timeZones = getTimeZones();

  const defaultInstructor = instructorParam && instructors.find(i => i.slug === instructorParam)
    ? instructorParam
    : instructors[0]?.slug || "";

  const submitMutation = useMutation({
    mutationFn: submitFreeMentorship,
    onSuccess: () => {
      form.reset();
    },
  });

  const form = useForm({
    defaultValues: {
      name: "",
      email: "",
      portfolioUrl: "",
      timeZone: "",
      artGoals: "",
      instructorSlug: defaultInstructor,
      consent: false,
    },
    onSubmit: async ({ value }) => {
      submitMutation.mutate({
        name: value.name,
        email: value.email,
        portfolioUrl: value.portfolioUrl || undefined,
        timeZone: value.timeZone,
        artGoals: value.artGoals,
        instructorSlug: value.instructorSlug,
        consent: value.consent,
      });
    },
  });

  const isSuccess = submitMutation.isSuccess;
  const error =
    submitMutation.error instanceof Error
      ? submitMutation.error.message
      : null;

  const selectedInstructor = instructors.find(i => i.slug === form.getFieldValue("instructorSlug"));

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">You're Signed Up!</CardTitle>
            <CardDescription>
              Thank you for your interest. You're now in the running to be selected.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground text-center">
              {selectedInstructor 
                ? `If ${selectedInstructor.name} selects you for a free mentorship session, we'll contact you at the email you provided.`
                : "If you're selected for a free mentorship session, we'll contact you at the email you provided."}
            </p>
            <p className="text-sm text-muted-foreground text-center">
              Note: Signing up does not guarantee a session. We'll be in touch only if you're selected.
            </p>
            <div className="flex flex-col gap-2">
              <Button asChild className="w-full">
                <Link href="/instructors">Browse All Instructors</Link>
              </Button>
              <Button asChild variant="outline" className="w-full">
                <Link href={defaultInstructor ? `/instructors/${defaultInstructor}` : "/instructors"}>
                  Back to Instructor
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (instructors.length === 0) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">No Free Mentorship Available</CardTitle>
            <CardDescription>
              There are no instructors offering free mentorship sessions at this time.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <Link href="/instructors">Browse All Instructors</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <Card className="max-w-lg w-full">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Free Mentorship Selection</CardTitle>
          <CardDescription>
            Sign up to potentially be selected for a free mentorship session.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-6 p-4 bg-muted rounded-lg border">
            <p className="text-sm text-muted-foreground">
              <strong>Important:</strong> This free mentorship session is provided as a single session. 
              By signing up, you understand and agree that:
            </p>
            <ul className="mt-2 text-sm text-muted-foreground list-disc list-inside space-y-1">
              <li>Signing up does not guarantee a free mentorship session</li>
              <li>You are signing up to potentially be selected for a free mentorship session</li>
              <li>The session may be recorded</li>
              <li>The footage may be used on our social media channels (including YouTube) for educational and promotional purposes</li>
              <li>You consent to being featured in these materials</li>
            </ul>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
            className="space-y-4"
          >
            <form.Field
              name="name"
              validators={{
                onChange: nameSchema,
              }}
            >
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>
                    Name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    placeholder="Your name"
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

            <form.Field
              name="email"
              validators={{
                onChange: emailSchema,
              }}
            >
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>
                    Email <span className="text-red-500">*</span>
                  </Label>
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

            <form.Field name="portfolioUrl">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>
                    Portfolio URL
                  </Label>
                  <Input
                    id={field.name}
                    type="url"
                    name={field.name}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    placeholder="https://yourportfolio.com"
                  />
                </div>
              )}
            </form.Field>

            <form.Field
              name="timeZone"
              validators={{
                onChange: timeZoneSchema,
              }}
            >
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>
                    Time Zone <span className="text-red-500">*</span>
                  </Label>
                  <select
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    aria-invalid={field.state.meta.errors.length > 0}
                    aria-describedby={
                      field.state.meta.errors.length > 0
                        ? `${field.name}-error`
                        : undefined
                    }
                  >
                    <option value="">Select your time zone</option>
                    {timeZones.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
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

            <form.Field
              name="artGoals"
              validators={{
                onChange: artGoalsSchema,
              }}
            >
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>
                    What would you like to improve with your art? <span className="text-red-500">*</span>
                  </Label>
                  <textarea
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    placeholder="Tell us about your goals and what you'd like to work on..."
                    rows={4}
                    className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
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

            {instructors.length > 1 && (
              <form.Field
                name="instructorSlug"
                validators={{
                  onChange: instructorSchema,
                }}
              >
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>
                      Instructor <span className="text-red-500">*</span>
                    </Label>
                    <select
                      id={field.name}
                      name={field.name}
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      aria-invalid={field.state.meta.errors.length > 0}
                      aria-describedby={
                        field.state.meta.errors.length > 0
                          ? `${field.name}-error`
                          : undefined
                      }
                    >
                      <option value="">Select an instructor</option>
                      {instructors.map((instructor) => (
                        <option key={instructor.slug} value={instructor.slug}>
                          {instructor.name}
                        </option>
                      ))}
                    </select>
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
            )}

            {error && (
              <div className="p-3 text-sm text-red-600 bg-red-50 dark:bg-red-950 dark:text-red-400 rounded-md">
                {error}
              </div>
            )}

            <form.Field
              name="consent"
              validators={{
                onChange: consentSchema,
              }}
            >
              {(field) => (
                <div className="space-y-2">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      id={field.name}
                      name={field.name}
                      checked={field.state.value}
                      onChange={(e) => field.handleChange(e.target.checked)}
                      onBlur={field.handleBlur}
                      className="mt-1 h-4 w-4 rounded border-gray-300"
                      aria-invalid={field.state.meta.errors.length > 0}
                      aria-describedby={
                        field.state.meta.errors.length > 0
                          ? `${field.name}-error`
                          : undefined
                      }
                    />
                    <label htmlFor={field.name} className="text-sm text-muted-foreground">
                      I understand and agree to the terms above. I consent to the session being recorded and used for educational and promotional purposes. <span className="text-red-500">*</span>
                    </label>
                  </div>
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

            <div className="flex flex-col gap-2">
              <Button
                type="submit"
                size="lg"
                className="w-full vibrant-gradient-button transition-all"
                disabled={form.state.isSubmitting || submitMutation.isPending}
              >
                {form.state.isSubmitting || submitMutation.isPending
                  ? "Signing Up..."
                  : "Sign Up to potentially Be Selected"}
              </Button>
              <Button asChild variant="outline" className="w-full">
                <Link href={defaultInstructor ? `/instructors/${defaultInstructor}` : "/instructors"}>
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

export default function FreeMentorshipPage(): React.JSX.Element {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center px-4">
          <Card className="max-w-lg w-full">
            <CardHeader className="text-center">
              <CardTitle className="text-2xl">Free Mentorship Session</CardTitle>
              <CardDescription>Loading...</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-muted-foreground">
                Loading form...
              </div>
            </CardContent>
          </Card>
        </div>
      }
    >
      <FreeMentorshipContent />
    </Suspense>
  );
}
