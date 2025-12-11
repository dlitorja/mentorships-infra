"use client";

import { useForm } from "@tanstack/react-form";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { matchingFormSchema } from "@/lib/validation-schemas";

export function MatchingSection(): React.JSX.Element {
  const form = useForm({
    defaultValues: {
      artGoals: "",
      email: "",
    },
    validators: {
      onChange: matchingFormSchema,
    },
    onSubmit: async ({ value }) => {
      // If email is provided, add to contacts database
      if (value.email) {
        try {
          const response = await fetch("/api/contacts", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              email: value.email,
              artGoals: value.artGoals,
            }),
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(
              errorData.error ||
                `Request failed with status ${response.status} ${response.statusText}`
            );
          }

          toast.success("Thank you! We'll be in touch soon.");
          form.reset();
        } catch (error) {
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
        toast.success("Thank you! We'll be in touch soon.");
        form.reset();
      }
    },
  });

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
            <form
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                form.handleSubmit();
              }}
              className="space-y-6"
            >
              <form.Field
                name="artGoals"
                validators={{
                  onChange: matchingFormSchema.shape.artGoals,
                }}
              >
                {(field) => (
                  <div className="space-y-4">
                    <label
                      htmlFor={field.name}
                      className="block text-center text-xl font-semibold text-white peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      What are your art goals?
                    </label>
                    <Textarea
                      id={field.name}
                      name={field.name}
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      placeholder="e.g., I want to improve my character design skills and build a portfolio for game studios. I'm particularly interested in fantasy art and have been working digitally for about 2 years..."
                      className="min-h-[120px] resize-none bg-white/10 border-white/20 text-white placeholder:text-white/50 focus:border-white/40"
                      aria-invalid={field.state.meta.errors.length > 0}
                      aria-describedby={
                        field.state.meta.errors.length > 0
                          ? `${field.name}-error`
                          : undefined
                      }
                    />
                    <p className="text-center text-xs text-white/70">
                      Be as specific as possible about your goals, experience level, and interests
                    </p>
                    {field.state.meta.errors.length > 0 && (
                      <p
                        id={`${field.name}-error`}
                        className="text-center text-xs text-red-400"
                      >
                        {field.state.meta.errors[0]}
                      </p>
                    )}
                  </div>
                )}
              </form.Field>

              <form.Field
                name="email"
                validators={{
                  onChange: matchingFormSchema.shape.email,
                }}
              >
                {(field) => (
                  <div className="space-y-2">
                    <label
                      htmlFor={field.name}
                      className="block text-center text-sm font-medium text-white"
                    >
                      Email Address (Optional)
                    </label>
                    <Input
                      id={field.name}
                      name={field.name}
                      type="email"
                      value={field.state.value || ""}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      className={`w-full bg-white/10 border ${
                        field.state.meta.errors.length > 0
                          ? "border-red-500 text-white placeholder:text-white/50 focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
                          : "border-white/20 text-white placeholder:text-white/50 focus:border-white/40 focus:outline-none focus:ring-2 focus:ring-white/20"
                      }`}
                      placeholder="your@email.com"
                      aria-invalid={field.state.meta.errors.length > 0}
                      aria-describedby={
                        field.state.meta.errors.length > 0
                          ? `${field.name}-error`
                          : field.state.value
                            ? `${field.name}-description`
                            : undefined
                      }
                    />
                    {field.state.meta.errors.length > 0 && (
                      <p
                        id={`${field.name}-error`}
                        className="text-center text-xs text-red-400"
                      >
                        {field.state.meta.errors[0]}
                      </p>
                    )}
                    {field.state.value && field.state.meta.errors.length === 0 && (
                      <p
                        id={`${field.name}-description`}
                        className="text-center text-xs text-white/60"
                      >
                        By providing your email, you opt in to receive communications
                        from us about mentorship opportunities and updates.
                      </p>
                    )}
                  </div>
                )}
              </form.Field>
              
              <Button
                type="submit"
                size="lg"
                className="w-full text-lg vibrant-gradient-button transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={
                  !form.state.values.artGoals.trim() ||
                  form.state.isSubmitting ||
                  form.state.meta.errors.length > 0
                }
              >
                {form.state.isSubmitting ? "Submitting..." : "Find My Match"}
                <Sparkles className="ml-2 h-4 w-4" />
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

