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
import { Button } from "@/components/ui/button";

type PublicInstructor = {
  _id: string;
  _creationTime: number;
  name?: string;
  slug?: string;
  tagline?: string;
  profileImageUrl?: string;
  specialties?: string[];
  isNew?: boolean;
  isHidden?: boolean;
  oneOnOneInventory?: number;
  groupInventory?: number;
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
  const { data: instructorsData, isLoading } = usePublicInstructors();
  const [instructors, setInstructors] = useState<PublicInstructor[]>([]);
  const [isClient, setIsClient] = useState(false);
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);
  const [count, setCount] = useState(0);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (!instructorsData) return;
    const visible = instructorsData.filter((inst: PublicInstructor) => !inst.isHidden);
    const shuffled = isClient ? shuffleArray(visible) : visible;
    setInstructors(shuffled);
  }, [instructorsData, isClient]);

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

  if (isLoading || instructors.length === 0) {
    return (
      <section id="instructors" className="bg-[#0f1117] py-20 px-6">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <h2 className="text-3xl sm:text-4xl font-bold text-white">
              Mentorships Open Now
            </h2>
            <p className="mt-4 text-[#a0a0b0]">Loading instructors...</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section id="instructors" className="bg-[#0f1117] py-20 px-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white">
            Mentorships Open Now
          </h2>
          <p className="mt-4 text-[#a0a0b0]">
            1-on-1 personalized guidance from industry professionals
          </p>
        </div>

        <Carousel
          setApi={setApi}
          opts={{ align: "start", loop: true }}
          className="w-full"
        >
          <CarouselContent className="-ml-2 md:-ml-4">
            {instructors.map((instructor) => (
              <CarouselItem
                key={instructor._id}
                className="pl-2 basis-[85%] sm:basis-1/2 md:basis-1/3 lg:basis-1/4 md:pl-4"
              >
                <Link
                  href={`/instructors/${instructor.slug}`}
                  className="group block"
                >
                  <div className="overflow-hidden rounded-lg border border-[#2a2d3e] bg-[#161822] transition-colors hover:border-[#7c3aed]/50">
                    <div className="relative aspect-square w-full overflow-hidden">
                      <Image
                        src={instructor.profileImageUrl || "/placeholder.jpg"}
                        alt={instructor.name ?? "Instructor"}
                        fill
                        className="object-cover transition-transform group-hover:scale-105"
                        sizes="(max-width: 640px) 85vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
                      />
                    </div>
                    <div className="p-4">
                      <h3 className="text-base font-semibold text-white group-hover:text-[#7c3aed] transition-colors">
                        {instructor.name}
                      </h3>
                      {instructor.tagline && (
                        <p className="mt-1 text-sm text-[#a0a0b0] line-clamp-2">
                          {instructor.tagline}
                        </p>
                      )}
                      {instructor.specialties && instructor.specialties.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {instructor.specialties.slice(0, 2).map((specialty: string) => (
                            <span
                              key={specialty}
                              className="inline-block rounded-full bg-[#7c3aed]/10 px-2 py-0.5 text-xs text-[#7c3aed]"
                            >
                              {specialty}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </Link>
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious className="hidden md:flex border-[#2a2d3e] bg-[#161822] text-white hover:bg-[#1a1d2e]" />
          <CarouselNext className="hidden md:flex border-[#2a2d3e] bg-[#161822] text-white hover:bg-[#1a1d2e]" />
        </Carousel>

        <div className="mt-4 text-center text-sm text-[#6b6b80]">
          {current} of {count}
        </div>

        <div className="mt-8 text-center">
          <Button asChild className="vibrant-gradient-button transition-all">
            <Link href="/instructors">See All Instructors</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}