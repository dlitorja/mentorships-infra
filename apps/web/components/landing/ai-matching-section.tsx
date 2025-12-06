"use client";

import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles } from "lucide-react";

export function AIMatchingSection() {
  const [artGoals, setArtGoals] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: Implement AI matching when backend is ready
    console.log("Art goals submitted:", artGoals);
  };

  return (
    <section id="find-match" className="py-20 px-4 bg-muted/30">
      <div className="mx-auto max-w-3xl">
        <Card className="border-2">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Sparkles className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="text-3xl">Find Your Perfect Match</CardTitle>
            <CardDescription className="text-base">
              Tell us about your art goals and we'll recommend the best instructors for you
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <label
                  htmlFor="art-goals"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  What are your art goals?
                </label>
                <Textarea
                  id="art-goals"
                  placeholder="e.g., I want to improve my character design skills and build a portfolio for game studios. I'm particularly interested in fantasy art and have been working digitally for about 2 years..."
                  value={artGoals}
                  onChange={(e) => setArtGoals(e.target.value)}
                  className="min-h-[120px] resize-none"
                />
                <p className="text-xs text-muted-foreground">
                  Be as specific as possible about your goals, experience level, and interests
                </p>
              </div>
              
              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={!artGoals.trim()}
              >
                Find My Match
                <Sparkles className="ml-2 h-4 w-4" />
              </Button>
              
              <p className="text-center text-xs text-muted-foreground">
                AI matching coming soon. For now, browse our instructors above.
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

