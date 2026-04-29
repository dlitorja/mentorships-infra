'use client';

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
import { shuffle } from '@/lib/utils/shuffle';

interface TestimonialWithInstructor {
  text: string;
  author: string;
  role?: string;
  instructorName: string;
  instructorSlug: string;
}

export function TestimonialsCarousel(): React.JSX.Element | null {
  const [randomizedTestimonials, setRandomizedTestimonials] = useState<TestimonialWithInstructor[]>([]);
  const [api, setApi] = useState<CarouselApi>();

  useEffect(() => {
    const allTestimonials: TestimonialWithInstructor[] = [];
    mockInstructors.forEach((instructor) => {
      if (instructor.isHidden) return;
      allTestimonials.push({
        text: 'Sample feedback — personalized mentorship experience with ' + instructor.name + '.',
        author: 'Sample student',
        role: 'Student',
        instructorName: instructor.name,
        instructorSlug: instructor.slug,
      });
    });
    const shuffled = shuffle(allTestimonials);
    setRandomizedTestimonials(shuffled);
  }, []);

  useEffect(() => {
    if (!api || randomizedTestimonials.length === 0) return;

    const interval = setInterval(() => {
      api.scrollNext();
    }, 6000);

    return () => clearInterval(interval);
  }, [api, randomizedTestimonials.length]);

  if (randomizedTestimonials.length === 0) {
    return (
      <div className='w-full h-64 animate-pulse bg-black/20 rounded-xl' aria-label='Loading testimonials...' />
    );
  }

  return (
    <Carousel
      setApi={setApi}
      opts={{
        align: 'start',
        loop: true,
      }}
      className='w-full'
    >
      <CarouselContent className='-ml-2 md:-ml-4'>
        {randomizedTestimonials.map((t, index) => (
          <CarouselItem
            key={`${t.instructorSlug}-${index}`}
            className='pl-2 md:basis-1/2 lg:basis-1/3 md:pl-4'
          >
            <div className='rounded-xl bg-black/70 backdrop-blur-sm p-6 h-full flex flex-col border border-white/10 shadow-lg'>
              <Quote className='h-6 w-6 text-white/80 mb-4 flex-shrink-0' />
              <div className='text-white/60 italic text-sm leading-relaxed mb-4 flex-grow'>
                <span className='text-white/50'>&ldquo;</span>{t.text}<span className='text-white/50'>&rdquo;</span>
              </div>
              <footer className='mt-4 text-sm text-white/70 flex-shrink-0' aria-label='Sample testimonial'>
                <p className='font-semibold'>— {t.author}</p>
                <p className='text-xs text-white/50 mt-1'>Sample — not real feedback</p>
                <Link
                  href={`/instructors/${t.instructorSlug}`}
                  className='text-xs text-white/60 hover:text-white mt-2 inline-block transition-colors'
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
