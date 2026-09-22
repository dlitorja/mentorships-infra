"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { z } from "zod";
import { waitlistFormSchema } from "@/lib/validation-schemas";
import { TurnstileWidget, type TurnstileWidgetHandle } from "@mentorships/ui";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAddToWaitlist } from "@/lib/queries/convex/use-waitlist";
import { api } from "@/convex/_generated/api";

const formSchema = waitlistFormSchema.extend({
  instructorSlug: z.string().optional(),
  type: z.enum(["one-on-one", "group"]).optional(),
});

function WaitlistContent() {
  const search = useSearchParams();
  const router = useRouter();

  const instructorSlug = search.get("instructor") || undefined;
  const type = ((): "one-on-one" | "group" | undefined => {
    const t = search.get("type");
    if (t === "one-on-one" || t === "group") return t;
    return undefined;
  })();

  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const widgetRef = useRef<TurnstileWidgetHandle>(null);

  const addToWaitlistMutation = useAddToWaitlist();

  const turnstileEnforcedQuery = useQuery({
    ...convexQuery(api.waitlist.isTurnstileEnforced, {}),
  });
  const turnstileSitekey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const turnstileConfigKnown = turnstileEnforcedQuery.isSuccess;
  const turnstileEnforced = turnstileEnforcedQuery.data === true;
  const turnstileConfigError = turnstileEnforcedQuery.isError;
  const turnstileUnavailable =
    turnstileConfigError ||
    (turnstileConfigKnown && turnstileEnforced && !turnstileSitekey);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    const parsed = formSchema.safeParse({ email, instructorSlug, type });
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message || "Please enter a valid email";
      setError(msg);
      return;
    }

    if (turnstileEnforced && !turnstileToken) {
      setError("Please complete the CAPTCHA before submitting.");
      return;
    }

    const mentorshipType =
      type === "group" ? "group" : "oneOnOne";

    setLoading(true);
    try {
      await addToWaitlistMutation.mutateAsync({
        email: parsed.data.email,
        instructorSlug: parsed.data.instructorSlug ?? "general",
        mentorshipType,
        ...(turnstileEnforced && turnstileToken
          ? { turnstileToken }
          : {}),
      });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      widgetRef.current?.reset();
    }
  }

  const title = instructorSlug ? "Join Waitlist" : "Join Our Waitlist";
  const description = instructorSlug
    ? `Get notified when ${instructorSlug.replace(/-/g, " ")}'s ${type === "group" ? "group mentorships" : "1-on-1 mentorship"} open up.`
    : "Get notified when new instructor spots open up.";

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <Card className="max-w-lg w-full">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          {success ? (
            <div className="space-y-4">
              <p className="text-green-700 dark:text-green-300">
                Thanks! You’re on the waitlist. We’ll email you when spots open.
              </p>
              {instructorSlug ? (
                <Button variant="outline" onClick={() => router.push(`/instructors/${instructorSlug}`)}>
                  Back to Instructor Profile
                </Button>
              ) : (
                <Button variant="outline" onClick={() => router.push("/")}>Go Home</Button>
              )}
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="email">Email</label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </div>

              {turnstileEnforced && turnstileSitekey ? (
                <TurnstileWidget
                  ref={widgetRef}
                  sitekey={turnstileSitekey}
                  action="waitlist_signup"
                  onTokenChange={setTurnstileToken}
                />
              ) : turnstileConfigError ? (
                <div className="p-3 text-sm text-red-600 bg-red-50 dark:bg-red-950 dark:text-red-400 rounded-md" role="alert">
                  CAPTCHA service unavailable. The waitlist form is temporarily disabled —
                  please try again in a few minutes. (Configuration error: could not reach
                  the verification server.)
                </div>
              ) : !turnstileConfigKnown ? (
                <p className="text-sm text-muted-foreground" role="status">
                  Verifying CAPTCHA requirements…
                </p>
              ) : turnstileEnforced && !turnstileSitekey ? (
                <div className="p-3 text-sm text-red-600 bg-red-50 dark:bg-red-950 dark:text-red-400 rounded-md" role="alert">
                  CAPTCHA service unavailable. The waitlist form is temporarily disabled —
                  please try again in a few minutes. (Configuration error: server enforces
                  Turnstile but NEXT_PUBLIC_TURNSTILE_SITE_KEY is not set in this deployment.)
                </div>
              ) : null}

              {error && (
                <div className="text-sm text-red-600">{error}</div>
              )}

              <div className="flex gap-2">
                <Button
                  type="submit"
                  disabled={loading || turnstileUnavailable || !turnstileConfigKnown || (turnstileEnforced && !turnstileToken)}
                  className="flex-1"
                >
                  {loading ? "Submitting..." : "Join Waitlist"}
                </Button>
                {instructorSlug ? (
                  <Button type="button" variant="outline" onClick={() => router.push(`/instructors/${instructorSlug}`)}>
                    Cancel
                  </Button>
                ) : (
                  <Button type="button" variant="outline" onClick={() => router.push("/")}>Cancel</Button>
                )}
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function WaitlistPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
          <Card className="max-w-lg w-full">
            <CardHeader>
              <CardTitle>Loading...</CardTitle>
              <CardDescription>Preparing waitlist form</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-muted-foreground">Please wait…</div>
            </CardContent>
          </Card>
        </div>
      }
    >
      <WaitlistContent />
    </Suspense>
  );
}
