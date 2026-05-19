"use client";

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

interface Instructor {
  _id: string;
  name?: string;
  slug?: string;
  tagline?: string;
  bio?: string;
  profileImageUrl?: string;
  portfolioImages?: string[];
  specialties?: string[];
  isCompletelySoldOut?: boolean;
}

interface InstructorGridProps {
  instructors: Instructor[];
  priorityIds: Set<string>;
}

function InstructorCardImage({ instructor, priority, soldOut }: { instructor: Instructor; priority: boolean; soldOut: boolean }) {
  const [hasError, setHasError] = useState(false);
  const src = hasError ? "/placeholder-instructor.jpg" : (instructor.profileImageUrl || "/placeholder-instructor.jpg");

  useEffect(() => {
    setHasError(false);
  }, [instructor.profileImageUrl]);

  return (
    <Link
      href={`/instructors/${instructor.slug}`}
      className='relative aspect-[4/3] w-full overflow-hidden cursor-pointer flex-shrink-0 rounded-lg'
    >
      <Image
        src={src}
        alt={`${instructor.name} profile picture`}
        fill
        className='object-cover transition-transform hover:scale-105'
        sizes='(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw'
        priority={priority}
        onError={() => setHasError(true)}
      />
      {soldOut && (
        <div
          aria-label='Sold out'
          className='absolute top-2 right-2 bg-red-600/90 text-white text-xs font-semibold px-2 py-1 rounded shadow-sm'
        >
          SOLD OUT
        </div>
      )}
    </Link>
  );
}

export function InstructorGrid({ instructors, priorityIds }: InstructorGridProps): React.JSX.Element {
  useEffect(() => {
    sessionStorage.setItem('instructorOrder', JSON.stringify(instructors.map((i) => i.slug)));
  }, [instructors]);

  return (
    <div className='grid gap-8 md:grid-cols-2 lg:grid-cols-3'>
      {instructors.map((instructor) => (
        <div
          key={instructor._id}
          className='flex flex-col'
        >
          <InstructorCardImage instructor={instructor} priority={priorityIds.has(instructor._id)} soldOut={Boolean(instructor.isCompletelySoldOut)} />

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
      ))}
    </div>
  );
}
