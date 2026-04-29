import { getRandomizedInstructors } from '@/lib/instructors';
import type { Instructor } from '@/lib/instructors';
import { InstructorGrid } from './instructor-grid';

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

          <InstructorGrid instructors={instructors} priorityIds={priorityIds} />

        </div>
      </div>
    </div>
  );
}

