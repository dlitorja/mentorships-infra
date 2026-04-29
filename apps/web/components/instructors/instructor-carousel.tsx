"use client";

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from '@/components/ui/carousel';
import { Button } from '@/components/ui/button';
import type { Instructor } from '@/lib/instructors';
import { getRandomizedInstructors } from '@/lib/instructors';

export function InstructorCarousel(): React.JSX.Element {
  const instructors = getRandomizedInstructors();
  const [api, setApi] = useState<CarouselApi>();
  const [paused, setPaused] = useState(false);

  const prefersReducedMotion = typeof window !== 'undefined'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  const startInterval = useCallback(() => {
    if (!api || instructors.length === 0 || prefersReducedMotion || paused) return;
    const interval = setInterval(() => {
      api.scrollNext();
    }, 5000);
    return () => clearInterval(interval);
  }, [api, instructors.length, prefersReducedMotion, paused]);

  useEffect(() => {
    return startInterval();
  }, [startInterval]);

  if (instructors.length === 0) {
    return (
      <div className='w-full h-64 animate-pulse bg-card rounded-xl' aria-label='Loading instructors...' />
    );
  }

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
        <CarouselContent className='-ml-2 md:-ml-4'>
          {instructors.map((instructor) => (
            <CarouselItem
              key={instructor.id}
              className='pl-2 md:basis-1/2 lg:basis-1/3 md:pl-4'
            >
              <div className='flex flex-col h-full'>
                <Link
                  href={`/instructors/${instructor.slug}`}
                  className='relative aspect-[4/3] w-full overflow-hidden cursor-pointer flex-shrink-0 rounded-lg'
                >
                  <Image
                    src={instructor.profileImage}
                    alt={`${instructor.name} profile picture`}
                    fill
                    className='object-cover transition-transform hover:scale-105'
                    sizes='(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw'
                  />
                </Link>
                <div className='pt-4 text-center'>
                  <h3 className='text-lg font-bold uppercase tracking-wide'>{instructor.name}</h3>
                  <p className='mt-1 text-sm text-muted-foreground uppercase tracking-wide'>{instructor.tagline}</p>
                  <div className='mt-4'>
                    <Button asChild variant='outline' size='sm' className='border-white/30 text-white hover:bg-white/10 uppercase tracking-wide text-xs'>
                      <Link href={`/instructors/${instructor.slug}`}>View Bio</Link>
                    </Button>
                  </div>
                </div>
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious className='hidden md:flex bg-card border-border text-white hover:bg-white/10' />
        <CarouselNext className='hidden md:flex bg-card border-border text-white hover:bg-white/10' />
      </Carousel>
    </div>
  );
}
