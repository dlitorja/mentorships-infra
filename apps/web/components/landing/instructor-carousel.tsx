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
import { getRandomizedInstructors } from "@/lib/instructors";

export function InstructorCarousel() {
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);
  const [count, setCount] = useState(0);

  useEffect(() => {
    // Randomize instructors on mount
    setInstructors(getRandomizedInstructors());
  }, []);

  useEffect(() => {
    if (!api) {
      return;
    }

    setCount(api.scrollSnapList().length);
    setCurrent(api.selectedScrollSnap() + 1);

    api.on("select", () => {
      setCurrent(api.selectedScrollSnap() + 1);
    });
  }, [api]);

  // Auto-rotate carousel every 5 seconds
  useEffect(() => {
    if (!api || instructors.length === 0) return;

    const interval = setInterval(() => {
      if (api.canScrollNext()) {
        api.scrollNext();
      } else {
        api.scrollTo(0); // Loop back to start
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [api, instructors.length]);

  if (instructors.length === 0) {
    return null;
  }

  return (
    <section id="instructors" className="py-20 px-4">
      <div className="mx-auto max-w-7xl">
        <div className="mb-12 text-center">
          <h2 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Our Instructors
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Discover talented artists from gaming, TV, film, and independent studios
          </p>
        </div>

        <Carousel
          setApi={setApi}
          opts={{
            align: "start",
            loop: true,
          }}
          className="w-full"
        >
          <CarouselContent className="-ml-2 md:-ml-4">
            {instructors.map((instructor) => (
              <CarouselItem
                key={instructor.id}
                className="pl-2 md:basis-1/2 lg:basis-1/3 md:pl-4"
              >
                <Card className="h-full overflow-hidden transition-shadow hover:shadow-lg">
                  <div className="relative aspect-[4/3] w-full overflow-hidden">
                    <Image
                      src={instructor.profileImage}
                      alt={instructor.name}
                      fill
                      className="object-cover"
                      sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                    />
                  </div>
                  <CardContent className="p-6">
                    <h3 className="text-xl font-semibold">{instructor.name}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {instructor.tagline}
                    </p>
                    
                    <div className="mt-4 flex flex-wrap gap-2">
                      {instructor.specialties.slice(0, 2).map((specialty) => (
                        <Badge key={specialty} variant="secondary" className="text-xs">
                          {specialty}
                        </Badge>
                      ))}
                    </div>
                    
                    <div className="mt-6">
                      <Button asChild variant="outline" className="w-full">
                        <Link href={`/instructors/${instructor.slug}`}>
                          View Profile
                        </Link>
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

        <div className="mt-6 text-center text-sm text-muted-foreground">
          {current} of {count}
        </div>
      </div>
    </section>
  );
}

