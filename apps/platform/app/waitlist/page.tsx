"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { waitlistFormSchema } from "@/lib/validation-schemas";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const formSchema = waitlistFormSchema.extend({
  instructorSlug: z.string().optional(),
  type: z.enum(["one-on-one", "group"]).optional(),
});

export default function WaitlistPage() {
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

    setLoading(true);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: parsed.data.email,
          instructorSlug: parsed.data.instructorSlug,
          type: parsed.data.type,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to join waitlist");
      }
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
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

              {error && (
                <div className="text-sm text-red-600">{error}</div>
              )}

              <div className="flex gap-2">
                <Button type="submit" disabled={loading} className="flex-1">
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
