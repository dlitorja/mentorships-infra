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
  const instructors = useInstructors();
  const priorityIds = getPriorityIds(instructors);

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