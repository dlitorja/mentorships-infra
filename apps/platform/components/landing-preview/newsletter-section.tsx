"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import { submitContact } from "@/lib/queries/api-client";
import { z } from "zod";

const emailSchema = z.string().email("Please enter a valid email address");

const waysToLearn = [
  {
    title: "Mentorships",
    description: "1-on-1 personalized guidance from industry professionals",
    href: "https://mentorships.huckleberry.art",
    external: true,
  },
  {
    title: "Online Courses",
    description: "Learn at your own pace with comprehensive video courses",
    href: "https://home.huckleberry.art/store",
    external: true,
  },
  {
    title: "Discord Community",
    description: "Join our growing community of artists from all walks of life",
    href: "https://discord.gg/4DqDyKZyA8",
    external: true,
  },
];

export function NewsletterSection() {
  const [email, setEmail] = useState("");

  const mutation = useMutation({
    mutationFn: (data: { email: string; artGoals: string }) => submitContact(data),
    onSuccess: () => {
      toast.success("Thank you! You'll hear from us soon.");
      setEmail("");
    },
    onError: () => {
      toast.error("Something went wrong. Please try again later.");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = emailSchema.safeParse(email);
    if (!result.success) {
      toast.error(result.error.issues[0]?.message || "Please enter a valid email");
      return;
    }
    mutation.mutate({ email, artGoals: "" });
  };

  return (
    <>
      <section className="bg-card py-16 px-6">
        <div className="mx-auto max-w-xl text-center">
          <div className="mb-2 flex justify-center">
            <Mail className="h-8 w-8 text-white/60" />
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-white">
            Stay Updated
          </h2>
          <p className="mt-4 text-white/70">
            Don&apos;t miss a spot and be the first to know when sign-ups open and new classes are announced.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 flex flex-col sm:flex-row gap-3">
            <Input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="flex-1 bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:border-white/40"
            />
            <Button
              type="submit"
              disabled={mutation.isPending || !email.trim()}
              className="bg-primary hover:bg-primary/90 text-primary-foreground px-8 min-h-[44px]"
            >
              {mutation.isPending ? "Signing up..." : "Sign Me Up!"}
            </Button>
          </form>

          <p className="mt-3 text-xs text-white/40">
            We don&apos;t spam! Read our privacy policy for more info.
          </p>
        </div>
      </section>

      <section className="bg-background py-20 px-6">
        <div className="mx-auto max-w-5xl">
          <div className="mb-12 text-center">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground">
              Many Ways to Learn
            </h2>
            <p className="mt-4 text-muted-foreground">
              We offer multiple avenues, both free and premium, to help you along your artistic journey.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-3">
            {waysToLearn.map((item) => (
              <a
                key={item.title}
                href={item.href}
                target={item.external ? "_blank" : undefined}
                rel={item.external ? "noopener noreferrer" : undefined}
                className="group border border-border bg-card p-6 hover:border-primary/50 transition-colors"
              >
                <h3 className="text-lg font-semibold text-foreground group-hover:text-primary transition-colors">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                  {item.description}
                </p>
                <span className="mt-4 inline-block text-sm text-primary group-hover:text-primary/80">
                  Learn more &rarr;
                </span>
              </a>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}