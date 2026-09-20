"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Search,
  Users,
  ChevronLeft,
  ChevronRight as ChevronRightIcon,
  Plus,
  Minus,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  useInstructorsWithStatsForAdmin,
  useInstructorWithStudents,
  useFullAdminCsvData,
  useIncrementRemainingSessions,
  useDecrementRemainingSessions,
  type InstructorWithStats,
  type InstructorStudentRow,
} from "@/lib/queries/convex/use-instructors";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * PR admin-mirror #4: the marketing admin instructors table is now
 * fully Convex-driven. SSR data and the three legacy API routes
 * (`/api/admin/instructors`, `/api/admin/instructors/[id]/mentees`,
 * `/api/admin/instructors/csv`, `/api/admin/session-counts`) are all
 * gone — replaced by the corresponding queries/mutations in
 * `convex/admin.ts` and the matching hooks in
 * `lib/queries/convex/use-instructors.ts`.
 *
 * The mutation hooks (`useIncrementRemainingSessions` /
 * `useDecrementRemainingSessions`) write back to Convex directly;
 * TanStack Query refetches the affected rows through the
 * `useInstructorWithStudents` subscription so the UI updates
 * immediately without an explicit reload.
 */

const PAGE_SIZE = 50;

function formatDate(epoch: number | null | undefined): string {
  if (!epoch) return "N/A";
  const date = new Date(epoch);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getStatusBadgeVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "active":
      return "default";
    case "depleted":
      return "secondary";
    case "expired":
    case "refunded":
      return "destructive";
    default:
      return "outline";
  }
}

function getSeatStatusBadgeVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "active":
      return "default";
    case "grace":
      return "secondary";
    case "released":
      return "destructive";
    default:
      return "outline";
  }
}

function StudentSessionControls({
  sessionPackId,
  currentRemaining,
}: {
  sessionPackId: Id<"sessionPacks">;
  currentRemaining: number;
}) {
  const increment = useIncrementRemainingSessions();
  const decrement = useDecrementRemainingSessions();
  const [pending, setPending] = useState<"inc" | "dec" | null>(null);

  const handleUpdate = async (action: "increment" | "decrement") => {
    if (action === "decrement" && currentRemaining <= 0) return;
    setPending(action === "increment" ? "inc" : "dec");
    try {
      await (action === "increment" ? increment : decrement)({
        sessionPackId,
      });
    } catch (err) {
      console.error("Error updating sessions:", err);
      alert("Failed to update sessions");
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => handleUpdate("decrement")}
        disabled={!!pending || currentRemaining <= 0}
        className="h-7 px-2"
      >
        {pending === "dec" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Minus className="h-3 w-3" />}
      </Button>
      <span className="w-6 text-center text-sm font-medium">{currentRemaining}</span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => handleUpdate("increment")}
        disabled={!!pending}
        className="h-7 px-2"
      >
        {pending === "inc" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
      </Button>
    </div>
  );
}

function StudentsTable({ students }: { students: InstructorStudentRow[] }) {
  if (students.length === 0) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        No active students for this instructor
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="text-left p-3 font-medium">Student Email</th>
            <th className="text-left p-3 font-medium">Sessions</th>
            <th className="text-left p-3 font-medium">Remaining</th>
            <th className="text-left p-3 font-medium">Status</th>
            <th className="text-left p-3 font-medium">Last Session</th>
            <th className="text-left p-3 font-medium">Seat Status</th>
            <th className="text-left p-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {students.map((student) => (
            <tr key={student.sessionPackId} className="border-b hover:bg-muted/25">
              <td className="p-3">
                <p className="font-medium">{student.email}</p>
              </td>
              <td className="p-3">
                <span className="font-medium">{student.completedSessionCount}</span>
                <span className="text-muted-foreground">/ {student.totalSessions}</span>
              </td>
              <td className="p-3">
                <span className={student.remainingSessions <= 1 ? "text-red-600 font-medium" : ""}>
                  {student.remainingSessions}
                </span>
              </td>
              <td className="p-3">
                <Badge variant={getStatusBadgeVariant(student.status)}>{student.status}</Badge>
              </td>
              <td className="p-3">{formatDate(student.lastSessionCompletedAt)}</td>
              <td className="p-3">
                <div className="flex flex-col gap-1">
                  <Badge variant={getSeatStatusBadgeVariant(student.seatStatus)}>
                    {student.seatStatus}
                  </Badge>
                  {student.seatExpiresAt && (
                    <span className="text-xs text-muted-foreground">
                      Expires: {formatDate(student.seatExpiresAt)}
                    </span>
                  )}
                </div>
              </td>
              <td className="p-3">
                <StudentSessionControls
                  sessionPackId={student.sessionPackId}
                  currentRemaining={student.remainingSessions}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExportCsvButton() {
  // Greptile P2: lazy fetch — the full report scans every session
  // pack, seat reservation, instructor, and user. We only trigger
  // it after the admin clicks the button.
  const [enabled, setEnabled] = useState(false);
  const { data: csvRows, isFetching, error } = useFullAdminCsvData(enabled);

  const handleClick = useCallback(() => {
    setEnabled(true);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (isFetching) return;
    if (error) {
      alert("Failed to load CSV data");
      setEnabled(false);
      return;
    }
    if (!csvRows || csvRows.length === 0) {
      alert("No data to export");
      setEnabled(false);
      return;
    }
    const header = [
      "instructorEmail",
      "studentEmail",
      "totalSessions",
      "remainingSessions",
      "packStatus",
      "packExpiresAt",
      "lastSessionDate",
      "completedSessionsCount",
      "seatStatus",
    ];
    const escape = (v: unknown): string => {
      if (v == null) return "";
      const s = String(v);
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    const lines = [header.join(",")];
    for (const row of csvRows) {
      lines.push(
        [
          row.instructorEmail,
          row.studentEmail,
          row.totalSessions,
          row.remainingSessions,
          row.packStatus,
          row.packExpiresAt ? new Date(row.packExpiresAt).toISOString() : "",
          row.lastSessionDate ? new Date(row.lastSessionDate).toISOString() : "",
          row.completedSessionsCount,
          row.seatStatus,
        ]
          .map(escape)
          .join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `instructors-report-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    setEnabled(false);
  }, [enabled, csvRows, isFetching, error]);

  return (
    <Button onClick={handleClick} variant="outline" disabled={isFetching}>
      <Download className="h-4 w-4 mr-2" />
      {isFetching ? "Preparing…" : "Export CSV"}
    </Button>
  );
}

function InstructorRow({
  instructor,
  isExpanded,
  onToggle,
}: {
  instructor: InstructorWithStats;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const instructorId = instructor.instructorId as Id<"instructors">;
  const { data: expandedData, isLoading, error: expandedError } = useInstructorWithStudents(
    isExpanded ? instructorId : null,
  );

  return (
    <>
      <tr
        className={`border-b hover:bg-muted/50 cursor-pointer transition-colors ${
          isExpanded ? "bg-muted/75" : ""
        }`}
        onClick={onToggle}
      >
        <td className="p-4 w-10">
          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </td>
        <td className="p-4">
          <div>
            <p className="font-medium">{instructor.email}</p>
          </div>
        </td>
        <td className="p-4">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <span>{instructor.activeStudentCount}</span>
          </div>
        </td>
        <td className="p-4">
          <div className="flex gap-2">
            <Badge variant="outline">1-on-1: {instructor.oneOnOneInventory}</Badge>
            <Badge variant="outline">Group: {instructor.groupInventory}</Badge>
          </div>
        </td>
        <td className="p-4">{formatDate(instructor.createdAt)}</td>
        <td className="p-4">
          <Button variant="ghost" size="sm">
            Manage
          </Button>
        </td>
      </tr>
      {isExpanded && (
        <tr className="bg-muted/30">
          <td colSpan={6} className="p-0">
            <div className="p-4">
              <h4 className="font-medium mb-3">
                Students ({expandedData?.students.length ?? 0})
              </h4>
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              ) : expandedError ? (
                <div className="p-4 text-center text-destructive">
                  Failed to load students. Please try again.
                </div>
              ) : (
                <StudentsTable students={expandedData?.students ?? []} />
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function InstructorsTable() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Greptile P1: initialize from URL so direct visits, bookmarks, and
  // browser back/forward restore the same view. `searchParams` is
  // stable across renders (Next.js caches the readonly params), so
  // this is effectively a lazy initializer.
  const initialSearch = searchParams?.get("search") ?? "";
  const initialPageRaw = searchParams?.get("page");
  const initialPage = initialPageRaw ? Math.max(1, parseInt(initialPageRaw, 10) || 1) : 1;

  const [page, setPage] = useState(initialPage);
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [search, setSearch] = useState(initialSearch);
  const [expandedInstructorId, setExpandedInstructorId] = useState<string | null>(null);

  const { data, isLoading, isFetching, error } = useInstructorsWithStatsForAdmin({
    search: search || undefined,
    page,
    pageSize: PAGE_SIZE,
  });
  const instructors: InstructorWithStats[] = data?.instructors ?? [];
  // `total` is the length of the current page (bounded `.take(N)` read
  // in the Convex query). For pagination we treat it as a hint: if
  // the page came back full, there may be more rows to discover, so
  // we always show the "Next" button when full or any prior page.
  const total: number = data?.total ?? 0;
  const isFullPage = instructors.length >= PAGE_SIZE;
  const totalPages = Math.max(page, isFullPage ? page + 1 : page);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput);
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (searchInput) {
      params.set("search", searchInput);
    } else {
      params.delete("search");
    }
    params.delete("page");
    router.push(`/admin/instructors?${params.toString()}`);
  };

  const handlePageChange = (newPage: number) => {
    if (newPage < 1) return;
    setPage(newPage);
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("page", newPage.toString());
    router.push(`/admin/instructors?${params.toString()}`);
  };

  const handleToggleExpand = useCallback((instructorId: string) => {
    setExpandedInstructorId((current) => (current === instructorId ? null : instructorId));
  }, []);

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between gap-4 mb-6">
        <form onSubmit={handleSearch} className="flex gap-2 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search by email..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
        <ExportCsvButton />
      </div>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left p-4 w-10"></th>
              <th className="text-left p-4 font-medium">Instructor</th>
              <th className="text-left p-4 font-medium">Active Students</th>
              <th className="text-left p-4 font-medium">Inventory</th>
              <th className="text-left p-4 font-medium">Joined</th>
              <th className="text-left p-4 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {error ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-destructive">
                  Failed to load instructors. Please try again.
                </td>
              </tr>
            ) : isLoading && instructors.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center">
                  <div className="flex items-center justify-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  </div>
                </td>
              </tr>
            ) : instructors.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted-foreground">
                  No instructors found
                </td>
              </tr>
            ) : (
              instructors.map((instructor) => (
                <InstructorRow
                  key={instructor.instructorId}
                  instructor={instructor}
                  isExpanded={expandedInstructorId === instructor.instructorId}
                  onToggle={() => handleToggleExpand(instructor.instructorId)}
                />
              ))
            )}
          </tbody>
        </table>
        {isFetching && !isLoading && instructors.length > 0 && (
          <div className="text-xs text-muted-foreground p-2 border-t bg-muted/20">
            Refreshing…
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mt-4">
        <p className="text-sm text-muted-foreground">
          Showing {instructors.length} instructor{instructors.length === 1 ? "" : "s"} on page {page}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePageChange(page - 1)}
            disabled={page === 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="flex items-center px-3 text-sm">
            Page {page}{isFullPage ? "+" : ""}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePageChange(page + 1)}
            disabled={!isFullPage}
          >
            <ChevronRightIcon className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
