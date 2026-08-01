import { Suspense } from 'react';
import { InstructorGrid } from './instructor-grid';

export const dynamic = 'force-dynamic';

function InstructorsSkeleton() {
  return (
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
  );
}

export default function InstructorsPage(): React.JSX.Element {
  return (
    <div className='min-h-screen bg-background'>
      <div className='container mx-auto px-4 py-16'>
        <div className='mx-auto max-w-7xl'>
          <div className='mb-16 text-center'>
            <h1 className='section-title'>Our Instructors</h1>
            <p className='mt-4 text-muted-foreground'>Browse our roster of world-class art instructors</p>
          </div>

          <Suspense fallback={<InstructorsSkeleton />}>
            <InstructorGrid />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
