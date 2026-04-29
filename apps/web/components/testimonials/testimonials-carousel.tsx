"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
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

function buildMockTestimonials(): TestimonialWithInstructor[] {
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
  for (let i = allTestimonials.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allTestimonials[i], allTestimonials[j]] = [allTestimonials[j], allTestimonials[i]];
  }
  return allTestimonials;
}

export function TestimonialsCarousel(): React.JSX.Element {
  const testimonials = useMemo(() => buildMockTestimonials(), []);
  const [api, setApi] = useState<CarouselApi>();
  const [paused, setPaused] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const startInterval = useCallback(() => {
    if (!api || testimonials.length === 0 || prefersReducedMotion || paused) return;
    const interval = setInterval(() => {
      api.scrollNext();
    }, 6000);
    return () => clearInterval(interval);
  }, [api, testimonials.length, prefersReducedMotion, paused]);

  useEffect(() => {
    return startInterval();
  }, [startInterval]);

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Carousel
        setApi={setApi}
        opts={{ align: 'start', loop: true }}
        className='w-full'
      >
        <CarouselContent className='-ml-4'>
          {testimonials.map((t, index) => (
            <CarouselItem
              key={`${t.instructorSlug}-${index}`}
              className='pl-4 md:basis-1/2 lg:basis-1/3'
            >
              <div className='rounded-lg bg-card p-6 h-full flex flex-col border border-border'>
                <Quote className='h-5 w-5 text-primary mb-4 flex-shrink-0' />
                <div className='text-white/90 leading-relaxed mb-4 flex-grow text-sm'>
                  {t.text.split('\n\n').map((paragraph, pIndex, paragraphs) => (
                    <p key={pIndex} className={pIndex > 0 ? 'mt-3' : ''}>
                      {pIndex === 0 && <span className='text-white/50'>&ldquo;</span>}
                      {paragraph}
                      {pIndex === paragraphs.length - 1 && <span className='text-white/50'>&rdquo;</span>}
                    </p>
                  ))}
                </div>
                <footer className='mt-4 text-sm flex-shrink-0 border-t border-border pt-4'>
                  <p className='font-semibold uppercase tracking-wide text-white text-xs'>{t.author}</p>
                  <p className='text-xs text-muted-foreground mt-1'>{t.role || 'Student'}</p>
                  <Link
                    href={`/instructors/${t.instructorSlug}`}
                    className='text-xs text-primary hover:text-primary/80 mt-2 inline-block transition-colors uppercase tracking-wide'
                  >
                    Learn from {t.instructorName}
                  </Link>
                </footer>
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious className='hidden md:flex -left-4 bg-card border-border text-white hover:bg-card/80' aria-label='Previous testimonial' />
        <CarouselNext className='hidden md:flex -right-4 bg-card border-border text-white hover:bg-card/80' aria-label='Next testimonial' />
      </Carousel>
    </div>
  );
}
