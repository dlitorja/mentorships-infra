'use client';

import { InstructorGrid } from './instructor-grid';
import { useInstructors } from '@/lib/queries/convex';

export const dynamic = 'force-dynamic';

function getPriorityIds(instructors: any[]): Set<string> {
  return new Set(
    instructors
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 6)
      .map((i) => i._id)
  );
}

export default function InstructorsPage(): React.JSX.Element {
  const { data: instructors, isLoading } = useInstructors();
  const priorityIds = getPriorityIds(instructors);

  if (isLoading) {
    return (
      <div className='min-h-screen bg-background'>
        <div className='container mx-auto px-4 py-16'>
          <div className='mx-auto max-w-7xl'>
            <div className='mb-16 text-center'>
              <h1 className='section-title'>Our Instructors</h1>
              <p className='mt-4 text-muted-foreground'>Browse our roster of world-class art instructors</p>
            </div>
            <div className='grid gap-8 md:grid-cols-2 lg:grid-cols-3'>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className='flex flex-col'>
                  <div className='relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-muted animate-pulse' />
                  <div className='pt-4 text-center space-y-2'>
                    <div className='h-5 w-3/4 mx-auto bg-muted rounded animate-pulse' />
                    <div className='h-4 w-5/6 mx-auto bg-muted rounded animate-pulse' />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className='min-h-screen bg-background'>
      <div className='container mx-auto px-4 py-16'>
        <div className='mx-auto max-w-7xl'>
          <div className='mb-16 text-center'>
            <h1 className='section-title'>Our Instructors</h1>
            <p className='mt-4 text-muted-foreground'>Browse our roster of world-class art instructors</p>
          </div>

          <InstructorGrid instructors={instructors} priorityIds={priorityIds} />
        </div>
      </div>
    </div>
  );
}