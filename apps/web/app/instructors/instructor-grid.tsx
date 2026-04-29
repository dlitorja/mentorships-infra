"use client";

import { useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
    <div className='grid gap-6 md:grid-cols-2 lg:grid-cols-3'>
      {instructors.map((instructor) => (
        <Card
          key={instructor.id}
          className='flex flex-col h-full overflow-hidden transition-shadow hover:shadow-lg'
        >
          <Link
            href={`/instructors/${instructor.slug}`}
            className='relative aspect-[4/3] w-full overflow-hidden cursor-pointer flex-shrink-0'
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

          <CardContent className='flex flex-col flex-1 p-6'>
            <h3 className='text-xl font-semibold'>{instructor.name}</h3>
            <p className='mt-1 text-sm text-muted-foreground'>{instructor.tagline}</p>

            <div className='mt-4 flex flex-wrap gap-2'>
              {instructor.specialties.slice(0, 3).map((specialty) => (
                <Badge key={specialty} variant='secondary' className='text-xs'>
                  {specialty}
                </Badge>
              ))}
              {instructor.specialties.length > 3 && (
                <Badge variant='secondary' className='text-xs'>
                  +{instructor.specialties.length - 3} more
                </Badge>
              )}
            </div>

            <div className='mt-auto pt-6'>
              <Button asChild variant='outline' className='w-full'>
                <Link href={`/instructors/${instructor.slug}`}>View Profile</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
