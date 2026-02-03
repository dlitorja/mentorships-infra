import { requireAdmin } from "@/lib/auth";
import { getAllInstructorsWithStats } from "@mentorships/db";
import { InstructorsTable } from "@/components/admin/instructors-table";

interface PageProps {
  searchParams: Promise<{
    search?: string;
    page?: string;
  }>;
}

function formatDateForSerialize(date: Date | null | undefined): string {
  if (!date) return new Date().toISOString();
  return date.toISOString();
}

export default async function AdminInstructorsPage({ searchParams }: PageProps): Promise<React.ReactElement> {
  await requireAdmin();

  const resolvedSearchParams = await searchParams;
  const search = resolvedSearchParams?.search;
  const page = resolvedSearchParams?.page ? parseInt(resolvedSearchParams.page, 10) : 1;

  let result: { instructors: Array<{
    mentorId: string;
    userId: string;
    email: string;
    bio: string | null;
    oneOnOneInventory: number;
    groupInventory: number;
    maxActiveStudents: number;
    activeMenteeCount: number;
    totalCompletedSessions: number;
    createdAt: Date;
  }>; total: number } | null = null;

  try {
    result = await getAllInstructorsWithStats(search, page, 50);
  } catch (error) {
    console.error("Error fetching instructors:", error);
    return (
      <div>
        <h1 className="text-3xl font-bold mb-2">Instructors</h1>
        <p className="text-muted-foreground mb-8">
          View all instructors, their active mentees, and session details.
        </p>
        <div className="p-4 border border-red-200 rounded-lg bg-red-50 text-red-600">
          Error loading instructors. Please try refreshing the page.
        </div>
      </div>
    );
  }

  const instructors = result.instructors.map((i) => ({
    mentorId: i.mentorId,
    userId: i.userId,
    email: i.email,
    bio: i.bio,
    oneOnOneInventory: i.oneOnOneInventory,
    groupInventory: i.groupInventory,
    maxActiveStudents: i.maxActiveStudents,
    activeMenteeCount: i.activeMenteeCount,
    totalCompletedSessions: i.totalCompletedSessions,
    createdAt: formatDateForSerialize(i.createdAt),
  }));

  return (
    <div>
      <h1 className="text-3xl font-bold mb-2">Instructors</h1>
      <p className="text-muted-foreground mb-8">
        View all instructors, their active mentees, and session details.
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
