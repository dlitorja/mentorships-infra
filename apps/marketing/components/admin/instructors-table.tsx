"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, Download, Search, Users, ChevronLeft, ChevronRight as ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type InstructorWithStats = {
  mentorId: string;
  userId: string;
  email: string;
  bio: string | null;
  oneOnOneInventory: number;
  groupInventory: number;
  maxActiveStudents: number;
  activeMenteeCount: number;
  totalCompletedSessions: number;
  createdAt: string;
};

type MenteeWithSessionInfo = {
  userId: string;
  email: string;
  sessionPackId: string;
  totalSessions: number;
  remainingSessions: number;
  status: string;
  expiresAt: string;
  lastSessionCompletedAt: string | null;
  completedSessionCount: number;
  seatStatus: "active" | "grace" | "released";
  seatExpiresAt: string | null;
};

type InstructorWithMentees = InstructorWithStats & {
  mentees: MenteeWithSessionInfo[];
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

function MenteesTable({ mentees }: { mentees: MenteeWithSessionInfo[] }) {
  if (mentees.length === 0) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        No active mentees for this instructor
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="text-left p-3 font-medium">Mentee Email</th>
            <th className="text-left p-3 font-medium">Sessions</th>
            <th className="text-left p-3 font-medium">Remaining</th>
            <th className="text-left p-3 font-medium">Status</th>
            <th className="text-left p-3 font-medium">Last Session</th>
            <th className="text-left p-3 font-medium">Seat Status</th>
          </tr>
        </thead>
        <tbody>
          {mentees.map((mentee) => (
            <tr key={mentee.sessionPackId} className="border-b hover:bg-muted/25">
              <td className="p-3">
                <p className="font-medium">{mentee.email}</p>
              </td>
              <td className="p-3">
                <span className="font-medium">{mentee.completedSessionCount}</span>
                <span className="text-muted-foreground">/ {mentee.totalSessions}</span>
              </td>
              <td className="p-3">
                <span className={mentee.remainingSessions <= 1 ? "text-red-600 font-medium" : ""}>
                  {mentee.remainingSessions}
                </span>
              </td>
              <td className="p-3">
                <Badge variant={getStatusBadgeVariant(mentee.status)}>
                  {mentee.status}
                </Badge>
              </td>
              <td className="p-3">
                {formatDate(mentee.lastSessionCompletedAt)}
              </td>
              <td className="p-3">
                <div className="flex flex-col gap-1">
                  <Badge variant={getSeatStatusBadgeVariant(mentee.seatStatus)}>
                    {mentee.seatStatus}
                  </Badge>
                  {mentee.seatExpiresAt && (
                    <span className="text-xs text-muted-foreground">
                      Expires: {formatDate(mentee.seatExpiresAt)}
                    </span>
                  )}
                </div>
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
  expandedMentees,
}: {
  instructor: InstructorWithStats;
  isExpanded: boolean;
  onToggle: () => void;
  expandedMentees: InstructorWithMentees | null;
}) {
  const [mentees, setMentees] = useState<MenteeWithSessionInfo[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isExpanded && !expandedMentees && !loading) {
      setLoading(true);
      fetch(`/api/admin/instructors/${instructor.mentorId}/mentees`)
        .then((res) => res.json())
        .then((data) => {
          if (data.mentees) {
            setMentees(data.mentees);
          }
        })
        .catch((err) => {
          console.error("Error loading mentees:", err);
        })
        .finally(() => {
          setLoading(false);
        });
    } else if (expandedMentees) {
      setMentees(expandedMentees.mentees);
    }
  }, [isExpanded, instructor.mentorId, loading, expandedMentees]);

  const displayMentees = expandedMentees?.mentees || mentees;

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
            <span>{instructor.activeMenteeCount}</span>
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
      </tr>
      {isExpanded && (
        <tr className="bg-muted/30">
          <td colSpan={6} className="p-0">
            <div className="p-4">
              <h4 className="font-medium mb-3">Mentees ({displayMentees.length})</h4>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              ) : (
                <MenteesTable mentees={displayMentees} />
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
  initialInstructors: InstructorWithStats[];
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
  const [expandedMentorId, setExpandedMentorId] = useState<string | null>(null);
  const [expandedMentees, setExpandedMentees] = useState<InstructorWithMentees | null>(null);
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

  const handleToggleExpand = async (mentorId: string) => {
    if (expandedMentorId === mentorId) {
      setExpandedMentorId(null);
      setExpandedMentees(null);
      return;
    }

    setExpandedMentorId(mentorId);
    setExpandedMentees(null);

    try {
      const res = await fetch(`/api/admin/instructors/${mentorId}/mentees`);
      const data = await res.json();
      if (data.mentees) {
        setExpandedMentees(data);
      }
    } catch (error) {
      console.error("Error loading mentees:", error);
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
              <th className="text-left p-4 font-medium">Active Mentees</th>
              <th className="text-left p-4 font-medium">Sessions Completed</th>
              <th className="text-left p-4 font-medium">Inventory</th>
              <th className="text-left p-4 font-medium">Joined</th>
            </tr>
          </thead>
          <tbody>
            {loading && instructors.length === 0 ? (
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
                  key={instructor.mentorId}
                  instructor={instructor}
                  isExpanded={expandedMentorId === instructor.mentorId}
                  onToggle={() => handleToggleExpand(instructor.mentorId)}
                  expandedMentees={expandedMentees?.mentorId === instructor.mentorId ? expandedMentees : null}
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
