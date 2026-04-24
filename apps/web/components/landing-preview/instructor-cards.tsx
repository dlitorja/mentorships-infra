"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel";
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

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function InstructorCards() {
  const { data: instructorsData, isLoading, isError } = usePublicInstructors();
  const [instructors, setInstructors] = useState<PublicInstructor[]>([]);
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!instructorsData) return;
    const visible = instructorsData.filter((inst: any) => !inst.isHidden);
    const shuffled = shuffleArray(visible);
    setInstructors(shuffled);
  }, [instructorsData]);

  useEffect(() => {
    if (!api) return;
    setCount(api.scrollSnapList().length);
    setCurrent(api.selectedScrollSnap() + 1);
    api.on("select", () => {
      setCurrent(api.selectedScrollSnap() + 1);
    });
  }, [api]);

  useEffect(() => {
    if (!api || instructors.length === 0) return;
    const interval = setInterval(() => {
      if (api.canScrollNext()) {
        api.scrollNext();
      } else {
        api.scrollTo(0);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [api, instructors.length]);

  if (isError) {
    return (
      <section id="instructors" className="bg-gray-50 py-20 px-6">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <h2 className="text-3xl sm:text-4xl font-bold text-[#1a1a2e]">
              Mentorships Open Now
            </h2>
            <p className="mt-4 text-gray-500">
              1-on-1 personalized guidance from industry professionals
            </p>
            <div className="mt-8">
              <Link
                href="/instructors"
                className="text-[#7c3aed] hover:text-[#6d28d9] font-semibold text-sm uppercase tracking-wider"
              >
                See All Instructors &rarr;
              </Link>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (isLoading) {
    return (
      <section id="instructors" className="bg-gray-50 py-20 px-6">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <h2 className="text-3xl sm:text-4xl font-bold text-[#1a1a2e]">
              Mentorships Open Now
            </h2>
            <p className="mt-4 text-gray-500">Loading instructors...</p>
          </div>
        </div>
      </section>
    );
  }

  if (instructors.length === 0) {
    return (
      <section id="instructors" className="bg-gray-50 py-20 px-6">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <h2 className="text-3xl sm:text-4xl font-bold text-[#1a1a2e]">
              Mentorships Open Now
            </h2>
            <p className="mt-4 text-gray-500">
              1-on-1 personalized guidance from industry professionals
            </p>
            <div className="mt-8">
              <Link
                href="/instructors"
                className="text-[#7c3aed] hover:text-[#6d28d9] font-semibold text-sm uppercase tracking-wider"
              >
                See All Instructors &rarr;
              </Link>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section id="instructors" className="bg-gray-50 py-20 px-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-[#1a1a2e]">
            Mentorships Open Now
          </h2>
          <p className="mt-4 text-gray-500">
            1-on-1 personalized guidance from industry professionals
          </p>
        </div>

        <Carousel
          setApi={setApi}
          opts={{ align: "start", loop: true }}
          className="w-full"
        >
          <CarouselContent className="-ml-2 md:-ml-4">
            {instructors.map((instructor: any) => (
              <CarouselItem
                key={instructor._id}
                className="pl-2 basis-[85%] sm:basis-1/2 md:basis-1/3 lg:basis-1/4 md:pl-4"
              >
                <Link
                  href={`/instructors/${instructor.slug}`}
                  className="group block"
                >
                  <div className="overflow-hidden bg-white border border-gray-200 hover:border-[#7c3aed]/50 transition-colors">
                    <div className="relative aspect-square w-full overflow-hidden bg-gray-100">
                      <Image
                        src={instructor.profileImageUrl || "/placeholder.jpg"}
                        alt={instructor.name ?? "Instructor"}
                        fill
                        className="object-cover transition-transform group-hover:scale-105"
                        sizes="(max-width: 640px) 85vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
                      />
                    </div>
                    <div className="p-3">
                      <h3 className="text-sm font-semibold text-[#1a1a2e] group-hover:text-[#7c3aed] transition-colors">
                        {instructor.name}
                      </h3>
                      {instructor.tagline && (
                        <p className="mt-1 text-xs text-gray-500 line-clamp-1">
                          {instructor.tagline}
                        </p>
                      )}
                    </div>
                  </div>
                </Link>
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious className="hidden md:flex" />
          <CarouselNext className="hidden md:flex" />
        </Carousel>

        <div className="mt-4 text-center text-sm text-gray-400">
          {current} of {count}
        </div>

        <div className="mt-8 text-center">
          <Link
            href="/instructors"
            className="text-[#7c3aed] hover:text-[#6d28d9] font-semibold text-sm uppercase tracking-wider"
          >
            See All Instructors &rarr;
          </Link>
        </div>
      </div>
    </section>
  );
}