"use client";

import Link from "next/link";
import { InstructorCarousel } from "@/components/instructors/instructor-carousel";

export function InstructorCards() {
  return (
    <section id="instructors" className="bg-background py-20 px-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground">
            Our Instructors
          </h2>
          <p className="mt-4 text-muted-foreground">
            Our instructors get to know you and help you work on specific skills based on your personalized goals
          </p>
        </div>

        <InstructorCarousel />

        <div className="mt-8 text-center">
          <Link
            href="/instructors"
            className="text-primary hover:text-primary/80 font-semibold text-sm uppercase tracking-wider"
          >
            See All Instructors &rarr;
          </Link>
        </div>
      </div>
    </section>
  );
}