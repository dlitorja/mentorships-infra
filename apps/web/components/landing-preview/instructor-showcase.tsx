"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePublicInstructors } from "@/lib/queries/convex/use-instructors";

type PublicInstructor = {
  _id: string;
  name?: string;
  slug?: string;
  tagline?: string;
  profileImageUrl?: string;
  specialties?: string[];
  isHidden?: boolean;
};

const MAX_SHOWCASE_INSTRUCTORS = 4;

export function InstructorShowcase() {
  const { data: instructorsData, isLoading, isError, error } = usePublicInstructors();
  const [featured, setFeatured] = useState<PublicInstructor[]>([]);

  useEffect(() => {
    if (!instructorsData) return;
    const visible = instructorsData.filter((inst: any) => !inst.isHidden);
    setFeatured(visible.slice(0, MAX_SHOWCASE_INSTRUCTORS));
  }, [instructorsData]);

  if (isError) {
    console.error("Failed to load public instructors", error);
    return null;
  }

  if (isLoading) {
    return (
      <section className="bg-background py-20 px-6">
        <div className="mx-auto max-w-5xl text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground">
            Our Instructors
          </h2>
          <p className="mt-4 text-muted-foreground">Loading instructors...</p>
        </div>
      </section>
    );
  }

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
          {featured.map((instructor: any, index: number) => {
            const isEven = index % 2 === 0;
            return (
              <div
                key={instructor._id}
                className={`flex flex-col gap-8 md:flex-row md:gap-16 items-center ${
                  isEven ? "" : "md:flex-row-reverse"
                }`}
              >
                <div className="w-full md:w-1/2 flex-shrink-0">
                  <div className="relative aspect-[3/4] w-full overflow-hidden bg-muted">
                    <Image
                      src={instructor.profileImageUrl || "/placeholder.jpg"}
                      alt={instructor.name ?? "Instructor"}
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
          <Link
            href="/instructors"
            className="inline-block bg-card text-white px-8 py-3 text-sm font-semibold uppercase tracking-wider hover:bg-secondary transition-colors"
          >
            View All Instructors
          </Link>
        </div>
      </div>
    </section>
  );
}
