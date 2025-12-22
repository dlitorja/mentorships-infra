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
      <div className="w-full h-64 animate-pulse bg-black/20 rounded-xl" aria-label="Loading testimonials..." />
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
        {randomizedTestimonials.map((testimonial, index) => (
          <CarouselItem
            key={`${testimonial.instructorSlug}-${testimonial.author}-${index}`}
            className="pl-2 md:basis-1/2 lg:basis-1/3 md:pl-4"
          >
            <div className="rounded-xl bg-black/70 backdrop-blur-sm p-6 h-full flex flex-col border border-white/10 shadow-lg">
              <Quote className="h-6 w-6 text-white/80 mb-4 flex-shrink-0" />
              <div className="text-white leading-relaxed mb-4 flex-grow">
                {testimonial.text.split("\n\n").map((paragraph, pIndex, paragraphs) => (
                  <p key={pIndex} className={pIndex > 0 ? "mt-4" : ""}>
                    {pIndex === 0 && '"'}
                    {paragraph}
                    {pIndex === paragraphs.length - 1 && '"'}
                  </p>
                ))}
              </div>
              <footer className="mt-4 text-sm text-white/90 flex-shrink-0">
                <p className="font-semibold">— {testimonial.author}</p>
                {testimonial.role && (
                  <p className="text-xs mt-1 text-white/80">{testimonial.role}</p>
                )}
                <Link
                  href={`/instructors/${testimonial.instructorSlug}`}
                  className="text-xs text-white/80 hover:text-white mt-2 inline-block transition-colors"
                >
                  Learn from {testimonial.instructorName} →
                </Link>
              </footer>
            </div>
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious className="hidden md:flex" />
      <CarouselNext className="hidden md:flex" />
    </Carousel>
  );
}

