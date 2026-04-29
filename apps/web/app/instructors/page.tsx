import Image from 'next/image';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getRandomizedInstructors } from '@/lib/instructors';
import type { Instructor } from '@/lib/instructors';

// Force dynamic rendering to ensure random order on each page load
export const dynamic = 'force-dynamic';

// Deterministically select first 6 visible instructors alphabetically for priority loading
function getPriorityIds(instructors: Instructor[]): Set<string> {
  return new Set(
    instructors
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 6)
      .map((i) => i.id)
  );
}

export default function InstructorsPage(): React.JSX.Element {
  const instructors = getRandomizedInstructors();
  const priorityIds = getPriorityIds(instructors);

  return (
    <div className='min-h-screen bg-background'>
      <div className='container mx-auto px-4 py-12'>
        <div className='mx-auto max-w-7xl'>
          <div className='mb-12 text-center'>
            <h1 className='text-4xl font-bold tracking-tight sm:text-5xl'>Our Instructors</h1>
          </div>

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
        </div>
      </div>
    </div>
  );
}