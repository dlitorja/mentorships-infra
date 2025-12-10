"use client";

import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles } from "lucide-react";
import { validateEmail } from "@/lib/validation";
import { toast } from "sonner";

type SubmitStatus = "idle" | "submitting" | "success" | "error";

export function MatchingSection(): React.JSX.Element {
  const [artGoals, setArtGoals] = useState("");
  const [email, setEmail] = useState("");
  const [isEmailValid, setIsEmailValid] = useState(true);
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>("idle");

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const value = e.target.value;
    setEmail(value);
    if (value) {
      setIsEmailValid(validateEmail(value) !== null);
    } else {
      setIsEmailValid(true); // Valid if empty (optional field)
    }
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setSubmitStatus("submitting");

    // Validate email if provided
    if (email && !validateEmail(email)) {
      setIsEmailValid(false);
      setSubmitStatus("error");
      toast.error("Please enter a valid email address");
      return;
    }

    // If email is provided, add to contacts database
    if (email) {
      try {
        const response = await fetch("/api/contacts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email,
            artGoals,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            errorData.error ||
              `Request failed with status ${response.status} ${response.statusText}`
          );
        }

        setSubmitStatus("success");
        toast.success("Thank you! We'll be in touch soon.");
        setEmail("");
        setArtGoals("");
      } catch (error) {
        setSubmitStatus("error");
        const errorMessage =
          error instanceof Error ? error.message : "Failed to submit";
        console.error("Failed to add email to contacts:", errorMessage);
        
        // Forward error to Better Stack via server-side API route
        fetch("/api/errors", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: errorMessage,
            level: "error",
            service: "mentorship-platform",
            component: "matching-section",
            error: {
              name: error instanceof Error ? error.name : "UnknownError",
              message: errorMessage,
            },
          }),
        }).catch(() => {
          // Silently fail if error tracking is unavailable
        });
        
        toast.error("Something went wrong. Please try again later.");
      }
    } else {
      // No email provided, just mark as success for now
      setSubmitStatus("success");
      toast.success("Thank you! We'll be in touch soon.");
      setArtGoals("");
    }
  };

  return (
    <section id="find-match" className="py-20 px-4 bg-muted/30">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 text-center">
          <div className="inline-block px-8 py-6 rounded-2xl bg-black/60 backdrop-blur-sm">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/20">
              <Sparkles className="h-6 w-6 text-white" />
            </div>
            <h2 className="text-3xl font-bold text-white">Find Your Perfect Match</h2>
            <p className="mt-4 text-base text-white/90">
              Tell us about your art goals and we'll recommend the best instructors for you
            </p>
          </div>
        </div>
        <Card className="border-2 bg-black/60 backdrop-blur-sm">
          <CardHeader className="text-center">
            <CardTitle className="sr-only">Find Your Perfect Match</CardTitle>
            <CardDescription className="sr-only">
              Tell us about your art goals and we'll recommend the best instructors for you
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-4">
                <label
                  htmlFor="art-goals"
                  className="block text-center text-xl font-semibold text-white peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  What are your art goals?
                </label>
                <Textarea
                  id="art-goals"
                  placeholder="e.g., I want to improve my character design skills and build a portfolio for game studios. I'm particularly interested in fantasy art and have been working digitally for about 2 years..."
                  value={artGoals}
                  onChange={(e) => setArtGoals(e.target.value)}
                  className="min-h-[120px] resize-none bg-white/10 border-white/20 text-white placeholder:text-white/50 focus:border-white/40"
                />
                <p className="text-center text-xs text-white/70">
                  Be as specific as possible about your goals, experience level, and interests
                </p>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="email"
                  className="block text-center text-sm font-medium text-white"
                >
                  Email Address (Optional)
                </label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={handleEmailChange}
                  className={`w-full bg-white/10 border ${
                    !isEmailValid
                      ? "border-red-500 text-white placeholder:text-white/50 focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
                      : "border-white/20 text-white placeholder:text-white/50 focus:border-white/40 focus:outline-none focus:ring-2 focus:ring-white/20"
                  }`}
                  placeholder="your@email.com"
                  aria-invalid={!isEmailValid}
                  aria-describedby={
                    !isEmailValid ? "email-error" : "email-description"
                  }
                />
                {!isEmailValid && (
                  <p
                    id="email-error"
                    className="text-center text-xs text-red-400"
                  >
                    Please enter a valid email address
                  </p>
                )}
                {email && isEmailValid && (
                  <p
                    id="email-description"
                    className="text-center text-xs text-white/60"
                  >
                    By providing your email, you opt in to receive communications
                    from us about mentorship opportunities and updates.
                  </p>
                )}
              </div>
              
              <Button
                type="submit"
                size="lg"
                className="w-full text-lg vibrant-gradient-button transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={
                  !artGoals.trim() ||
                  submitStatus === "submitting" ||
                  Boolean(email && !isEmailValid)
                }
              >
                {submitStatus === "submitting"
                  ? "Submitting..."
                  : "Find My Match"}
                <Sparkles className="ml-2 h-4 w-4" />
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

