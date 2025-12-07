"use client";

import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles } from "lucide-react";

export function MatchingSection(): JSX.Element {
  const [artGoals, setArtGoals] = useState("");

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    // TODO: Implement matching when backend is ready
    console.log("Art goals submitted");
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
              
              <Button
                type="submit"
                size="lg"
                className="w-full text-lg vibrant-gradient-button transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={!artGoals.trim()}
              >
                Find My Match
                <Sparkles className="ml-2 h-4 w-4" />
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

