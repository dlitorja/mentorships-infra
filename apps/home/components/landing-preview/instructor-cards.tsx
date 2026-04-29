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
import { getRandomizedInstructors, type Instructor } from "@mentorships/ui";

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function InstructorCards() {
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);
  const [count, setCount] = useState(0);

  useEffect(() => {
    const allInstructors = getRandomizedInstructors();
    setInstructors(allInstructors);
  }, []);

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

  if (instructors.length === 0) {
    return (
      <section id="instructors" className="bg-background py-20 px-6">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground">
              Our Instructors
            </h2>
            <p className="mt-4 text-muted-foreground">
              Our instructors get to know you and help you work on specific skills based on your personalized goals
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section id="instructors" className="bg-background py-20 px-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground">
            Our Instructors
          </h2>
          <p className="mt-4 text-muted-foreground">
            Our instructors get to know you and help you work on specific skills based on your personalized goals
          </p>
        </div>

        <Carousel
          setApi={setApi}
          opts={{ align: "start", loop: true }}
          className="w-full"
        >
          <CarouselContent className="-ml-2 md:-ml-4">
            {instructors.map((instructor, index) => (
              <CarouselItem
                key={instructor.id}
                className="pl-2 basis-[85%] sm:basis-1/2 md:basis-1/3 lg:basis-1/4 md:pl-4"
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
                      sizes="(max-width: 640px) 85vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
                      priority={index === 0}
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

        <div className="mt-4 text-center text-sm text-muted-foreground">
          {current} of {count}
        </div>

        <div className="mt-8 text-center">
          <Link
            href="/instructors"
            className="text-primary hover:text-primary/80 font-semibold text-sm uppercase tracking-wider"
          >
            See All Instructors &rarr;
          </Link>
        </div>
      </div>
    </section>
  );
}