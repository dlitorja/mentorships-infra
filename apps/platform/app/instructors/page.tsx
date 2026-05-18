'use client';

import { InstructorGrid } from './instructor-grid';
import { usePublicInstructors } from '@/lib/queries/convex';

export const dynamic = 'force-dynamic';

type InstructorSummary = { _id: string; name?: string };

function getPriorityIds(instructors: InstructorSummary[]): Set<string> {
  return new Set(
    instructors
      .slice()
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
      .slice(0, 6)
      .map((i) => i._id)
  );
}

export default function InstructorsPage(): React.JSX.Element {
  // Public-facing page: use the public query that does not require auth
  const { data: instructors, isLoading, isError } = usePublicInstructors();
  const priorityIds = getPriorityIds(instructors);

  if (isError) {
    return (
      <div className='min-h-screen bg-background'>
        <div className='container mx-auto px-4 py-16'>
          <div className='mx-auto max-w-7xl'>
            <div className='mb-16 text-center'>
              <h1 className='section-title'>Our Instructors</h1>
              <p className='mt-4 text-muted-foreground'>Browse our roster of world-class art instructors</p>
            </div>
            <p className='text-center text-muted-foreground'>
              We couldn&apos;t load instructors right now. Please try again.
            </p>
          </div>
        </div>
      </div>
    );
  }

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
