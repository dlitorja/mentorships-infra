"use client";

import Image from "next/image";
import Link from "next/link";
import { getRandomizedInstructors, type Instructor } from "@mentorships/ui";
import { Button } from "@/components/ui/button";

const MAX_SHOWCASE_INSTRUCTORS = 4;

export function InstructorShowcase() {
  const allInstructors = getRandomizedInstructors();
  const featured = allInstructors.slice(0, MAX_SHOWCASE_INSTRUCTORS);

  if (featured.length === 0) {
    return null;
  }

  return (
    <section className="bg-background py-20 px-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-16 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground">
            Our Instructors
          </h2>
        </div>

        <div className="space-y-24">
          {featured.map((instructor: Instructor, index: number) => {
            const isEven = index % 2 === 0;
            return (
              <div
                key={instructor.id}
                className={`flex flex-col gap-8 md:flex-row md:gap-16 items-center ${
                  isEven ? "" : "md:flex-row-reverse"
                }`}
              >
                <div className="w-full md:w-1/2 flex-shrink-0">
                  <div className="relative aspect-[3/4] w-full overflow-hidden bg-muted">
                    <Image
                      src={instructor.profileImage}
                      alt={`${instructor.name} profile picture`}
                      fill
                      className="object-cover"
                      sizes="(max-width: 768px) 100vw, 50vw"
                    />
                  </div>
                </div>

                <div className="w-full md:w-1/2 space-y-4">
                  <h3 className="text-3xl sm:text-4xl font-bold text-foreground">
                    {instructor.name}
                  </h3>
                  {instructor.specialties && instructor.specialties.length > 0 && (
                    <p className="text-sm font-semibold uppercase tracking-widest text-primary">
                      {instructor.specialties.join(" \u00b7 ")}
                    </p>
                  )}
                  {instructor.tagline && (
                    <p className="text-muted-foreground leading-relaxed">
                      {instructor.tagline}
                    </p>
                  )}
                  <div>
                    <Link
                      href={`/instructors/${instructor.slug}`}
                      className="inline-block text-primary hover:text-primary/80 font-semibold text-sm uppercase tracking-wider transition-colors"
                    >
                      View Bio &rarr;
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-16 text-center">
          <Button asChild variant="default" size="lg" className="bg-card hover:bg-secondary text-white uppercase tracking-wider font-semibold">
            <Link href="/instructors">
              View All Instructors
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}