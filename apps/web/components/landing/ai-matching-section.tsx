"use client";

import { useForm } from "@tanstack/react-form";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles } from "lucide-react";
import { simpleMatchingFormSchema } from "@/lib/validation-schemas";

export function MatchingSection() {
  const form = useForm({
    defaultValues: {
      artGoals: "",
    },
    validators: {
      onChange: simpleMatchingFormSchema,
    },
    onSubmit: async ({ value }) => {
      // TODO: Implement matching when backend is ready
      console.log("Art goals submitted", value.artGoals);
      form.reset();
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
                  onChange: simpleMatchingFormSchema.shape.artGoals,
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
              
              <Button
                type="submit"
                size="lg"
                className="w-full text-lg vibrant-gradient-button transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={!form.state.values.artGoals.trim() || form.state.isSubmitting}
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

