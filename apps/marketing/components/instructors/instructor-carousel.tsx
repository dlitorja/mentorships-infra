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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Instructor } from "@/lib/instructors";
import { getVisibleInstructors } from "@/lib/instructors";
import { shuffleArray } from "@/lib/utils";

export function InstructorCarousel(): React.JSX.Element | null {
  const [randomizedInstructors, setRandomizedInstructors] = useState<Instructor[]>([]);
  const [api, setApi] = useState<CarouselApi>();

  useEffect(() => {
    // Randomize visible instructors on mount to ensure equal exposure
    const visibleInstructors = getVisibleInstructors();
    const shuffled = shuffleArray(visibleInstructors);
    setRandomizedInstructors(shuffled);
  }, []);

  // Auto-rotate carousel every 5 seconds
  useEffect(() => {
    if (!api || randomizedInstructors.length === 0) return;

    const interval = setInterval(() => {
      api.scrollNext(); // loop: true handles wrap-around
    }, 5000);

    return () => clearInterval(interval);
  }, [api, randomizedInstructors.length]);

  if (randomizedInstructors.length === 0) {
    return (
      <div className="w-full h-64 animate-pulse bg-card rounded-lg" aria-label="Loading instructors..." />
    );
  }

  return (
    <Carousel
      setApi={setApi}
      opts={{
        align: "start",
        loop: true,
      }}
      className="w-full"
    >
      <CarouselContent className="-ml-4">
        {randomizedInstructors.map((instructor, index) => (
          <CarouselItem
            key={instructor.id}
            className="pl-4 md:basis-1/2 lg:basis-1/3"
          >
            <div className="group">
              <Link
                href={`/instructors/${instructor.slug}`}
                className="relative aspect-[4/3] w-full overflow-hidden cursor-pointer block rounded-lg"
              >
                <Image
                  src={instructor.profileImage}
                  alt={`${instructor.name} profile picture`}
                  fill
                  className="object-cover transition-transform duration-300 group-hover:scale-105"
                  sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                  priority={index < 3}
                />
                {instructor.isNew && (
                  <Badge
                    className="absolute top-4 left-4 bg-primary text-primary-foreground px-3 py-1 rounded text-xs font-semibold uppercase tracking-wide"
                    aria-label="New instructor"
                  >
                    NEW
                  </Badge>
                )}
              </Link>
              <div className="mt-4">
                <h3 className="text-xl font-bold uppercase tracking-wider text-white">{instructor.name}</h3>
                <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">{instructor.tagline}</p>
                <div className="mt-4">
                  <Button asChild variant="outline" size="sm" className="border-white/30 text-white hover:bg-white/10 uppercase tracking-wide text-xs font-semibold">
                    <Link href={`/instructors/${instructor.slug}`} aria-label={`View bio for ${instructor.name}`}>View Bio</Link>
                  </Button>
                </div>
              </div>
            </div>
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious className="hidden md:flex -left-4 bg-card border-border text-white hover:bg-card/80" />
      <CarouselNext className="hidden md:flex -right-4 bg-card border-border text-white hover:bg-card/80" />
    </Carousel>
  );
}
