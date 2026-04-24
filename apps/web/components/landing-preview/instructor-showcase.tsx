"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePublicInstructors } from "@/lib/queries/convex/use-instructors";

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
      <section className="bg-white py-20 px-6">
        <div className="mx-auto max-w-5xl text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-[#1a1a2e]">
            Our Instructors
          </h2>
          <p className="mt-4 text-gray-500">Loading instructors...</p>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-white py-20 px-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-16 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-[#1a1a2e]">
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
                  <div className="relative aspect-[3/4] w-full overflow-hidden bg-gray-100">
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
                  <h3 className="text-3xl sm:text-4xl font-bold text-[#1a1a2e]">
                    {instructor.name}
                  </h3>
                  {instructor.specialties && instructor.specialties.length > 0 && (
                    <p className="text-sm font-semibold uppercase tracking-widest text-[#7c3aed]">
                      {instructor.specialties.join(" \u00b7 ")}
                    </p>
                  )}
                  {instructor.tagline && (
                    <p className="text-gray-600 leading-relaxed">
                      {instructor.tagline}
                    </p>
                  )}
                  <div>
                    <Link
                      href={`/instructors/${instructor.slug}`}
                      className="inline-block text-[#7c3aed] hover:text-[#6d28d9] font-semibold text-sm uppercase tracking-wider transition-colors"
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
            className="inline-block bg-[#1a1a2e] text-white px-8 py-3 text-sm font-semibold uppercase tracking-wider hover:bg-[#2a2a3e] transition-colors"
          >
            View All Instructors
          </Link>
        </div>
      </div>
    </section>
  );
}