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
  const page = resolvedSearchParams?.page ? parseInt(resolvedSearchParams.page, 10) : 1;

  const result = await getAllInstructorsWithStats(search, page, 50);

  const instructors = result.instructors.map((i) => ({
    ...i,
    createdAt: i.createdAt.toISOString(),
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
