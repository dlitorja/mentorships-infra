import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowDown } from "lucide-react";

export function HeroSection() {
  return (
    <section className="relative flex min-h-[90vh] flex-col items-center justify-center px-4 py-20 text-center">
      <div className="mx-auto max-w-4xl space-y-8">
        <h1 className="text-5xl font-bold tracking-tight sm:text-6xl md:text-7xl">
          Huckleberry Art Mentorships
        </h1>
        
        <p className="text-xl text-muted-foreground sm:text-2xl">
          Connect with world-class instructors for personalized 1-on-1 and group mentorship experiences
        </p>
        
        <p className="mx-auto max-w-2xl text-lg leading-relaxed text-muted-foreground">
          Learn from industry professionals across gaming, TV, film, and independent art businesses. 
          Whether you're looking for focused one-on-one guidance or collaborative group sessions, 
          our diverse roster of instructors brings real-world experience to help you achieve your artistic goals.
        </p>
        
        <div className="flex flex-col gap-4 sm:flex-row sm:justify-center">
          <Button asChild size="lg" className="text-lg">
            <Link href="#instructors">Browse Instructors</Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="text-lg">
            <Link href="#find-match">Find Your Match</Link>
          </Button>
        </div>
        
        <div className="pt-8">
          <a
            href="#instructors"
            className="inline-flex flex-col items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Scroll to instructors"
          >
            <span className="text-sm">Explore</span>
            <ArrowDown className="h-6 w-6 animate-bounce" />
          </a>
        </div>
      </div>
    </section>
  );
}

