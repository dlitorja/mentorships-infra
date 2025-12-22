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
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Instructor } from "@/lib/instructors";
import { instructors } from "@/lib/instructors";

// Fisher-Yates shuffle algorithm to randomize array
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function InstructorCarousel(): React.JSX.Element | null {
  const [randomizedInstructors, setRandomizedInstructors] = useState<Instructor[]>([]);
  const [api, setApi] = useState<CarouselApi>();

  useEffect(() => {
    // Randomize instructors on mount to ensure equal exposure
    const shuffled = shuffleArray(instructors);
    setRandomizedInstructors(shuffled);
  }, []);

  // Auto-rotate carousel every 5 seconds
  useEffect(() => {
    if (!api || randomizedInstructors.length === 0) return;

    const interval = setInterval(() => {
      if (api.canScrollNext()) {
        api.scrollNext();
      } else {
        api.scrollTo(0); // Loop back to start
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [api, randomizedInstructors.length]);

  if (randomizedInstructors.length === 0) {
    return null;
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
      <CarouselContent className="-ml-2 md:-ml-4">
        {randomizedInstructors.map((instructor, index) => (
          <CarouselItem
            key={instructor.id}
            className="pl-2 md:basis-1/2 lg:basis-1/3 md:pl-4"
          >
            <Card className="flex flex-col h-full overflow-hidden transition-shadow hover:shadow-lg">
              <Link
                href={`/instructors/${instructor.slug}`}
                className="relative aspect-[4/3] w-full overflow-hidden cursor-pointer flex-shrink-0"
              >
                <Image
                  src={instructor.profileImage}
                  alt={`${instructor.name} profile picture`}
                  fill
                  className="object-cover transition-transform hover:scale-105"
                  sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                  priority={index < 3}
                />
              </Link>
              <CardContent className="flex flex-col flex-1 p-6">
                <h3 className="text-xl font-semibold">{instructor.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{instructor.tagline}</p>

                <div className="mt-4 flex flex-wrap gap-2">
                  {instructor.specialties.slice(0, 3).map((specialty) => (
                    <Badge key={specialty} variant="secondary" className="text-xs">
                      {specialty}
                    </Badge>
                  ))}
                </div>

                <div className="mt-auto pt-6">
                  <Button asChild variant="outline" className="w-full">
                    <Link href={`/instructors/${instructor.slug}`}>View Profile</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious className="hidden md:flex" />
      <CarouselNext className="hidden md:flex" />
    </Carousel>
  );
}

