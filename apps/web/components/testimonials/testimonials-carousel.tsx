"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Quote } from 'lucide-react';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from '@/components/ui/carousel';
import { mockInstructors } from '@/lib/instructors';

interface TestimonialWithInstructor {
  text: string;
  author: string;
  role?: string;
  instructorName: string;
  instructorSlug: string;
}

export function TestimonialsCarousel(): React.JSX.Element {
  const [testimonials, setTestimonials] = useState<TestimonialWithInstructor[]>([]);
  const [api, setApi] = useState<CarouselApi>();

  useEffect(() => {
    const allTestimonials: TestimonialWithInstructor[] = [];
    mockInstructors.forEach((instructor) => {
      if (instructor.isHidden) return;
      allTestimonials.push({
        text: `Working with ${instructor.name} helped me grow as an artist. The personalized feedback and mentorship were invaluable.`,
        author: instructor.name.split(' ')[0] + ' S.',
        role: 'Student',
        instructorName: instructor.name,
        instructorSlug: instructor.slug,
      });
    });
    // Fisher-Yates shuffle
    for (let i = allTestimonials.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allTestimonials[i], allTestimonials[j]] = [allTestimonials[j], allTestimonials[i]];
    }
    setTestimonials(allTestimonials);
  }, []);

  useEffect(() => {
    if (!api || testimonials.length === 0) return;
    const interval = setInterval(() => {
      api.scrollNext();
    }, 6000);
    return () => clearInterval(interval);
  }, [api, testimonials.length]);

  if (testimonials.length === 0) {
    return (
      <div className='w-full h-64 animate-pulse bg-black/20 rounded-xl' aria-label='Loading testimonials...' />
    );
  }

  return (
    <Carousel
      setApi={setApi}
      opts={{ align: 'start', loop: true }}
      className='w-full'
    >
      <CarouselContent className='-ml-2 md:-ml-4'>
        {testimonials.map((t, index) => (
          <CarouselItem
            key={`${t.instructorSlug}-${index}`}
            className='pl-2 md:basis-1/2 lg:basis-1/3 md:pl-4'
          >
            <div className='rounded-xl bg-black/70 backdrop-blur-sm p-6 h-full flex flex-col border border-white/10 shadow-lg'>
              <Quote className='h-6 w-6 text-white/80 mb-4 flex-shrink-0' />
              <div className='text-white leading-relaxed mb-4 flex-grow'>
                <span className='text-white/80'>&ldquo;</span>{t.text}<span className='text-white/80'>&rdquo;</span>
              </div>
              <footer className='mt-4 text-sm text-white/90 flex-shrink-0'>
                <p className='font-semibold'>— {t.author}</p>
                <Link
                  href={`/instructors/${t.instructorSlug}`}
                  className='text-xs text-white/80 hover:text-white mt-2 inline-block transition-colors'
                >
                  Learn from {t.instructorName} →
                </Link>
              </footer>
            </div>
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious className='hidden md:flex' />
      <CarouselNext className='hidden md:flex' />
    </Carousel>
  );
}
