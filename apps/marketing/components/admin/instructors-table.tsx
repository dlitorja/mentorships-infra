"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, Download, Search, Users, ChevronLeft, ChevronRight as ChevronRightIcon, Plus, Minus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type UIInstructorStats = {
  instructorId: string;
  userId: string;
  email: string;
  bio: string | null;
  oneOnOneInventory: number;
  groupInventory: number;
  maxActiveStudents: number;
  activeStudentCount: number;
  totalCompletedSessions: number;
  createdAt: string;
};

type StudentWithSessionInfo = {
  userId: string;
  email: string;
  sessionPackId: string;
  totalSessions: number;
  remainingSessions: number;
  status: string;
  expiresAt: string | null;
  lastSessionCompletedAt: string | null;
  completedSessionCount: number;
  seatStatus: "active" | "grace" | "released";
  seatExpiresAt: string | null;
};

type InstructorWithStudents = UIInstructorStats & {
  students: StudentWithSessionInfo[];
};

function formatDate(dateString: string | null): string {
  if (!dateString) return "N/A";
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(dateString: string | null): string {
  if (!dateString) return "N/A";
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getStatusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
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

function getSeatStatusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
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

function StudentSessionControls({ sessionPackId, currentRemaining }: { sessionPackId: string; currentRemaining: number }) {
  const [remaining, setRemaining] = useState(currentRemaining);
  const [isLoading, setIsLoading] = useState(false);

  const handleUpdate = async (action: "increment" | "decrement") => {
    if (action === "decrement" && remaining <= 0) return;

    setIsLoading(true);
    try {
      const response = await fetch("/api/admin/session-counts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionPackId, action }),
      });

      if (response.ok) {
        const data = await response.json();
        setRemaining(data.remainingSessions);
      } else {
        const error = await response.json();
        alert(error.error || "Failed to update sessions");
      }
    } catch (err) {
      console.error("Error updating sessions:", err);
      alert("Failed to update sessions");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => handleUpdate("decrement")}
        disabled={isLoading || remaining <= 0}
        className="h-7 px-2"
      >
        {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Minus className="h-3 w-3" />}
      </Button>
      <span className="w-6 text-center text-sm font-medium">{remaining}</span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => handleUpdate("increment")}
        disabled={isLoading}
        className="h-7 px-2"
      >
        {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
      </Button>
    </div>
  );
}

function StudentsTable({ students }: { students: StudentWithSessionInfo[] }) {
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
                <Badge variant={getStatusBadgeVariant(student.status)}>
                  {student.status}
                </Badge>
              </td>
              <td className="p-3">
                {formatDate(student.lastSessionCompletedAt)}
              </td>
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

function InstructorRow({
  instructor,
  isExpanded,
  onToggle,
  expandedStudents,
}: {
  instructor: UIInstructorStats;
  isExpanded: boolean;
  onToggle: () => void;
  expandedStudents: InstructorWithStudents | null;
}) {
  const [students, setStudents] = useState<StudentWithSessionInfo[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isExpanded && !expandedStudents && !loading) {
      setLoading(true);
      fetch(`/api/admin/instructors/${instructor.instructorId}/mentees`)
        .then((res) => res.json())
        .then((data) => {
          if (data.students) {
            setStudents(data.students);
          }
        })
        .catch((err) => {
          console.error("Error loading students:", err);
        })
        .finally(() => {
          setLoading(false);
        });
    } else if (expandedStudents) {
      setStudents(expandedStudents.students);
    }
  }, [isExpanded, instructor.instructorId, loading, expandedStudents]);

  const displayStudents = expandedStudents?.students || students;

  return (
    <>
      <tr
        className={`border-b hover:bg-muted/50 cursor-pointer transition-colors ${
          isExpanded ? "bg-muted/75" : ""
        }`}
        onClick={onToggle}
      >
        <td className="p-4 w-10">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
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
          <span className="font-medium">{instructor.totalCompletedSessions}</span>
        </td>
        <td className="p-4">
          <div className="flex gap-2">
            <Badge variant="outline">
              1-on-1: {instructor.oneOnOneInventory}
            </Badge>
            <Badge variant="outline">
              Group: {instructor.groupInventory}
            </Badge>
          </div>
        </td>
        <td className="p-4">
          {formatDate(instructor.createdAt)}
        </td>
        <td className="p-4">
          <Button variant="ghost" size="sm">
            Manage
          </Button>
        </td>
      </tr>
      {isExpanded && (
        <tr className="bg-muted/30">
          <td colSpan={7} className="p-0">
            <div className="p-4">
              <h4 className="font-medium mb-3">Students ({displayStudents.length})</h4>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              ) : (
                <StudentsTable students={displayStudents} />
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function InstructorsTable({
  initialInstructors,
  initialTotal,
  initialPage,
  initialSearch,
}: {
  initialInstructors: UIInstructorStats[];
  initialTotal: number;
  initialPage: number;
  initialSearch: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [instructors, setInstructors] = useState(initialInstructors);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(initialPage);
  const [search, setSearch] = useState(initialSearch);
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [expandedInstructorId, setExpandedInstructorId] = useState<string | null>(null);
  const [expandedStudents, setExpandedStudents] = useState<InstructorWithStudents | null>(null);
  const [loading, setLoading] = useState(false);

  const pageSize = 50;
  const totalPages = Math.ceil(total / pageSize);

  const loadInstructors = useCallback(async (searchTerm: string, pageNum: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchTerm) params.set("search", searchTerm);
      params.set("page", pageNum.toString());
      params.set("pageSize", pageSize.toString());

      const res = await fetch(`/api/admin/instructors?${params}`);
      const data = await res.json();

      if (data.instructors) {
        setInstructors(data.instructors);
        setTotal(data.total);
      }
    } catch (error) {
      console.error("Error loading instructors:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    loadInstructors(searchInput, 1);

    const params = new URLSearchParams(searchParams);
    if (searchInput) {
      params.set("search", searchInput);
    } else {
      params.delete("search");
    }
    params.delete("page");
    router.push(`/admin/instructors?${params.toString()}`);
  };

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return;
    setPage(newPage);
    loadInstructors(search, newPage);

    const params = new URLSearchParams(searchParams);
    params.set("page", newPage.toString());
    router.push(`/admin/instructors?${params.toString()}`);
  };

  const handleToggleExpand = async (instructorId: string) => {
    if (expandedInstructorId === instructorId) {
      setExpandedInstructorId(null);
      setExpandedStudents(null);
      return;
    }

    setExpandedInstructorId(instructorId);
    setExpandedStudents(null);

    try {
      const res = await fetch(`/api/admin/instructors/${instructorId}/mentees`);
      const data = await res.json();
      if (data.students) {
        setExpandedStudents(data);
      }
    } catch (error) {
      console.error("Error loading students:", error);
    }
  };

  const handleExportCsv = async () => {
    try {
      const res = await fetch("/api/admin/instructors/csv");
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `instructors-report-${new Date().toISOString().split("T")[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch (error) {
      console.error("Error exporting CSV:", error);
    }
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between gap-4 mb-6">
        <form onSubmit={handleSearch} className="flex gap-2 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search by name or email..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
        <Button onClick={handleExportCsv} variant="outline">
          <Download className="h-4 w-4 mr-2" />
          Export CSV
        </Button>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left p-4 w-10"></th>
              <th className="text-left p-4 font-medium">Instructor</th>
              <th className="text-left p-4 font-medium">Active Students</th>
              <th className="text-left p-4 font-medium">Sessions Completed</th>
              <th className="text-left p-4 font-medium">Inventory</th>
              <th className="text-left p-4 font-medium">Joined</th>
              <th className="text-left p-4 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && instructors.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center">
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
                  expandedStudents={expandedStudents?.instructorId === instructor.instructorId ? expandedStudents : null}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-muted-foreground">
            Showing {instructors.length} of {total} instructors
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
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(page + 1)}
              disabled={page === totalPages}
            >
              <ChevronRightIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
