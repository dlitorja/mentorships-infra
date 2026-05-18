import { requireAdmin } from "@/lib/auth";
import { getAllInstructorsWithStats } from "@mentorships/db";
import { InstructorsTable } from "@/components/admin/instructors-table";

interface PageProps {
  searchParams: Promise<{
    search?: string;
    page?: string;
  }>;
}

export default async function AdminInstructorsPage({ searchParams }: PageProps): Promise<React.ReactElement> {
  await requireAdmin();

  const resolvedSearchParams = await searchParams;
  const search = resolvedSearchParams?.search;
  const rawPage = resolvedSearchParams?.page;
  const parsedPage = rawPage ? parseInt(rawPage, 10) : 1;
  const page = Number.isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage;

  const result = await getAllInstructorsWithStats(search, page, 50);

  // Map DB result to UI shape, handling legacy field names if present
  const instructors = result.instructors.map((i: any) => ({
    instructorId: i.instructorId ?? i.mentorId,
    userId: i.userId,
    email: i.email,
    bio: i.bio ?? null,
    oneOnOneInventory: i.oneOnOneInventory,
    groupInventory: i.groupInventory,
    maxActiveStudents: i.maxActiveStudents,
    activeStudentCount: i.activeStudentCount ?? i.activeMenteeCount ?? 0,
    totalCompletedSessions: i.totalCompletedSessions ?? 0,
    createdAt: (i.createdAt instanceof Date ? i.createdAt : new Date(i.createdAt)).toISOString(),
  }));

  return (
    <div>
      <h1 className="text-3xl font-bold mb-2">Instructors</h1>
      <p className="text-muted-foreground mb-8">
        View all instructors, their active students, and session details.
      </p>

      <InstructorsTable
        initialInstructors={instructors}
        initialTotal={result.total}
        initialPage={page}
        initialSearch={search || ""}
      />
    </div>
  );
}
