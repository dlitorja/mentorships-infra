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
      <div className="w-full h-64 animate-pulse bg-black/20 rounded-xl" aria-label="Loading instructors..." />
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
                 {instructor.isNew && (
                   <Badge
                     className="absolute top-4 left-4 bg-green-500 text-white px-3 py-1 rounded-full text-xs font-semibold"
                     aria-label="New instructor"
                   >
                     NEW
                   </Badge>
                 )}
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

