"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePublicInstructors } from "@/lib/queries/convex/use-instructors";
import { Button } from "@/components/ui/button";

const MAX_SHOWCASE_INSTRUCTORS = 4;

export function InstructorShowcase() {
  const { data: instructorsData, isLoading } = usePublicInstructors();
  const [featured, setFeatured] = useState<any[]>([]);

  useEffect(() => {
    if (!instructorsData) return;
    const visible = instructorsData.filter((inst: any) => !inst.isHidden);
    setFeatured(visible.slice(0, MAX_SHOWCASE_INSTRUCTORS));
  }, [instructorsData]);

  if (isLoading || featured.length === 0) {
    return (
      <section className="bg-[#161822] py-20 px-6">
        <div className="mx-auto max-w-6xl text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white">
            Our Instructors
          </h2>
          <p className="mt-4 text-[#a0a0b0]">Loading instructors...</p>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-[#161822] py-20 px-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white">
            Our Instructors
          </h2>
          <p className="mt-4 text-[#a0a0b0]">
            Learn from artists who&apos;ve built successful creative careers
          </p>
        </div>

        <div className="space-y-16">
          {featured.map((instructor, index) => {
            const isEven = index % 2 === 0;
            return (
              <div
                key={instructor._id}
                className={`flex flex-col gap-8 md:flex-row md:gap-12 items-center ${
                  isEven ? "" : "md:flex-row-reverse"
                }`}
              >
                <div className="w-full md:w-1/2 flex-shrink-0">
                  <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg">
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
                  <h3 className="text-2xl sm:text-3xl font-bold text-white">
                    {instructor.name}
                  </h3>
                  {instructor.specialties && instructor.specialties.length > 0 && (
                    <p className="text-sm font-semibold uppercase tracking-wider text-[#7c3aed]">
                      {instructor.specialties.join(" \u00b7 ")}
                    </p>
                  )}
                  {instructor.tagline && (
                    <p className="text-[#a0a0b0] leading-relaxed">
                      {instructor.tagline}
                    </p>
                  )}
                  <div>
                    <Link
                      href={`/instructors/${instructor.slug}`}
                      className="inline-block text-[#7c3aed] hover:text-[#9f67ff] transition-colors font-medium"
                    >
                      View Profile &rarr;
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-12 text-center">
          <Button asChild className="vibrant-gradient-button transition-all">
            <Link href="/instructors">View All Instructors</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}