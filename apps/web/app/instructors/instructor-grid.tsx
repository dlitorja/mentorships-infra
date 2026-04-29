"use client";

import { useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import type { Instructor } from '@/lib/instructors';

interface InstructorGridProps {
  instructors: Instructor[];
  priorityIds: Set<string>;
}

export function InstructorGrid({ instructors, priorityIds }: InstructorGridProps): React.JSX.Element {
  useEffect(() => {
    sessionStorage.setItem('instructorOrder', JSON.stringify(instructors.map((i) => i.slug)));
  }, [instructors]);

  return (
    <div className='grid gap-8 md:grid-cols-2 lg:grid-cols-3'>
      {instructors.map((instructor) => (
        <div
          key={instructor.id}
          className='flex flex-col'
        >
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
              priority={priorityIds.has(instructor.id)}
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
      ))}
    </div>
  );
}
