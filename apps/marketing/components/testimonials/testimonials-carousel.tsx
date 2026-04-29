"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Quote } from "lucide-react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel";
import { instructors } from "@/lib/instructors";
import type { Testimonial } from "@/lib/instructors";
import { shuffleArray } from "@/lib/utils";

interface TestimonialWithInstructor extends Testimonial {
  instructorName: string;
  instructorSlug: string;
}

export function TestimonialsCarousel(): React.JSX.Element | null {
  const [randomizedTestimonials, setRandomizedTestimonials] = useState<TestimonialWithInstructor[]>([]);
  const [api, setApi] = useState<CarouselApi>();

  useEffect(() => {
    // Collect all testimonials from all instructors
    const allTestimonials: TestimonialWithInstructor[] = [];
    
    instructors.forEach((instructor) => {
      if (instructor.testimonials && instructor.testimonials.length > 0) {
        instructor.testimonials.forEach((testimonial) => {
          allTestimonials.push({
            ...testimonial,
            instructorName: instructor.name,
            instructorSlug: instructor.slug,
          });
        });
      }
    });

    // Randomize testimonials on mount to ensure equal exposure
    const shuffled = shuffleArray(allTestimonials);
    setRandomizedTestimonials(shuffled);
  }, []);

  // Auto-rotate carousel every 6 seconds
  useEffect(() => {
    if (!api || randomizedTestimonials.length === 0) return;

    const interval = setInterval(() => {
      api.scrollNext(); // loop: true handles wrap-around
    }, 6000);

    return () => clearInterval(interval);
  }, [api, randomizedTestimonials.length]);

  if (randomizedTestimonials.length === 0) {
    return (
      <div className="w-full h-64 animate-pulse bg-card rounded-lg" aria-label="Loading testimonials..." />
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
        {randomizedTestimonials.map((testimonial, index) => (
          <CarouselItem
            key={`${testimonial.instructorSlug}-${testimonial.author}-${index}`}
            className="pl-4 md:basis-1/2 lg:basis-1/3"
          >
            <div className="rounded-lg bg-card p-6 h-full flex flex-col border border-border">
              <Quote className="h-5 w-5 text-primary mb-4 flex-shrink-0" />
              <div className="text-white/90 leading-relaxed mb-4 flex-grow text-sm">
                {testimonial.text.split("\n\n").map((paragraph, pIndex, paragraphs) => (
                  <p key={pIndex} className={pIndex > 0 ? "mt-3" : ""}>
                    {pIndex === 0 && '"'}
                    {paragraph}
                    {pIndex === paragraphs.length - 1 && '"'}
                  </p>
                ))}
              </div>
              <footer className="mt-4 text-sm flex-shrink-0 border-t border-border pt-4">
                <p className="font-semibold uppercase tracking-wide text-white text-xs">{testimonial.author}</p>
                {testimonial.role && (
                  <p className="text-xs mt-1 text-muted-foreground">{testimonial.role}</p>
                )}
                <Link
                  href={`/instructors/${testimonial.instructorSlug}`}
                  className="text-xs text-primary hover:text-primary/80 mt-2 inline-block transition-colors uppercase tracking-wide"
                >
                  Learn from {testimonial.instructorName}
                </Link>
              </footer>
            </div>
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious className="hidden md:flex -left-4 bg-card border-border text-white hover:bg-card/80" />
      <CarouselNext className="hidden md:flex -right-4 bg-card border-border text-white hover:bg-card/80" />
    </Carousel>
  );
}
