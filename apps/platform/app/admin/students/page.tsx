"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, Plus, UserPlus } from "lucide-react";
import { getAdminStudents, getAdminInstructors, addAdminStudentSessions } from "@/lib/queries/api-client";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

type StudentItem = {
  userId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  sessionPacks: Array<{
    id: string;
    instructorId: string;
    instructorName: string | null;
    instructorSlug?: string | null;
    totalSessions: number;
    remainingSessions: number;
    status: string;
    purchasedAt: string;
    expiresAt: string | null;
  }>;
};

const SessionPackSchema = z.object({
  id: z.string(),
  instructorId: z.string(),
  instructorName: z.string().nullable(),
  instructorSlug: z.string().nullable().optional(),
  totalSessions: z.number(),
  remainingSessions: z.number(),
  status: z.string(),
  purchasedAt: z.string(),
  expiresAt: z.string().nullable(),
});

const StudentItemSchema = z.object({
  userId: z.string(),
  email: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  sessionPacks: z.array(SessionPackSchema),
});

const StudentsResponseSchema = z.object({
  items: z.array(StudentItemSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  /** Set when the API answered 206 because Convex failed. */
  degraded: z.boolean().optional(),
});

type StudentsResponse = z.infer<typeof StudentsResponseSchema>;

const PAGE_SIZE = 20;

async function fetchStudents(search: string | undefined, page: number): Promise<StudentsResponse> {
  const data = await getAdminStudents({
    search: search || undefined,
    page,
    pageSize: PAGE_SIZE,
  });
  try {
    return StudentsResponseSchema.parse(data);
  } catch (e) {
    console.error('Students response parse error:', e, 'Data:', JSON.stringify(data, null, 2));
    throw e;
  }
}

async function fetchInstructors() {
  const data = await getAdminInstructors({ includeInactive: true });
  return {
      instructors: data.instructors.map((inst) => ({
        id: inst.instructorId,
        name: inst.displayName || inst.email || inst.instructorId,
      })),
  };
}

async function addSessionsToStudent(userId: string, data: { instructorId: string; totalSessions: number; expiresAt?: string }) {
  return addAdminStudentSessions(userId, data);
}

const DEFAULT_ADD_SESSIONS_COUNT = 4;

export default function StudentsPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [page, setPage] = useState(1);
  // Reset during render when the search changes, so the first request for a new
  // search is already page 1 (an effect-based reset fetched the old page first
  // and let a slow response overwrite the newer one).
  const lastSearchRef = useRef(debouncedSearch);
  if (lastSearchRef.current !== debouncedSearch) {
    lastSearchRef.current = debouncedSearch;
    if (page !== 1) setPage(1);
  }
  const [addSessionsOpen, setAddSessionsOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<StudentItem | null>(null);
  const [selectedInstructorId, setSelectedInstructorId] = useState("");
  const [totalSessions, setTotalSessions] = useState(String(DEFAULT_ADD_SESSIONS_COUNT));
  const [expiresAt, setExpiresAt] = useState("");
  const [addError, setAddError] = useState("");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin-students", debouncedSearch, page],
    queryFn: () => fetchStudents(debouncedSearch || undefined, page),
  });

  const { data: instructorsData, isLoading: isLoadingInstructors } = useQuery({
    queryKey: ["instructors"],
    queryFn: fetchInstructors,
  });

  const addSessionsMutation = useMutation({
    mutationFn: ({ userId, data }: { userId: string; data: { instructorId: string; totalSessions: number; expiresAt?: string } }) =>
      addSessionsToStudent(userId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-students"] });
      setAddSessionsOpen(false);
      setSelectedStudent(null);
      setSelectedInstructorId("");
      setTotalSessions(String(DEFAULT_ADD_SESSIONS_COUNT));
      setExpiresAt("");
      setAddError("");
    },
    onError: (err) => {
      setAddError(err instanceof Error ? err.message : "Failed to add sessions");
    },
  });

  const students = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstOnPage = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastOnPage = (page - 1) * PAGE_SIZE + students.length;

  /**
   * Name first, email second, and never a raw Clerk id as the headline — the
   * repo's convention, and the previous `email || userId` fallback displayed
   * `user_3K…` as the primary identifier for anyone without an email.
   */
  const fullName = (s: StudentItem) =>
    [s.firstName, s.lastName].filter(Boolean).join(" ").trim() || null;
  const primaryLabel = (s: StudentItem) =>
    fullName(s) || s.email || "Student (no name or email on file)";

  const isClerkUserId = (id: string) => id.startsWith("user_");

  const handleOpenAddSessions = (student: StudentItem) => {
    setSelectedStudent(student);
    setAddSessionsOpen(true);
    setAddError("");
  };

  const handleAddSessions = () => {
    if (!selectedStudent?.userId || !selectedInstructorId) return;
    const sessions = parseInt(totalSessions, 10);
    if (isNaN(sessions) || sessions < 1) {
      setAddError("Please enter a valid number of sessions");
      return;
    }
    addSessionsMutation.mutate({
      userId: selectedStudent.userId,
      data: {
        instructorId: selectedInstructorId,
        totalSessions: sessions,
        expiresAt: expiresAt || undefined,
      },
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active": return "default";
      case "depleted": return "secondary";
      case "expired": return "destructive";
      case "refunded": return "outline";
      default: return "secondary";
    }
  };

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Students</h1>
          <p className="text-sm text-muted-foreground">View and manage students. Search by name or email.</p>
        </div>
        <Button asChild>
          <Link href="/admin/students/invite">
            <Plus className="mr-2 h-4 w-4" /> Invite by Email
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>All Students</CardTitle>
            <CardDescription>
              {total === 0
                ? "No results"
                : `Showing ${firstOnPage}–${lastOnPage} of ${total}`}
            </CardDescription>
          </div>
          <div className="w-full max-w-sm">
            <label htmlFor="students-search" className="sr-only">Search students by name or email</label>
            <Input
              id="students-search"
              aria-label="Search students by name or email"
              placeholder="Search by name or email"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          {data?.degraded && (
            <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              Partial data: the student service returned an error, so this list may be incomplete.
              <Button size="sm" variant="outline" className="ml-3" onClick={() => refetch()}>
                Retry
              </Button>
            </div>
          )}
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-destructive">Couldn&apos;t load students</p>
                  <p className="text-xs text-destructive/80 mt-1">
                    {error instanceof Error ? error.message : "The request failed."} This is not an
                    empty roster.
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => refetch()}>
                  Retry
                </Button>
              </div>
            </div>
          ) : students.length === 0 ? (
            <div className="text-center py-12">
              {debouncedSearch ? (
                <>
                  <p className="text-muted-foreground mb-2">No students match “{debouncedSearch}”</p>
                  <Button variant="outline" size="sm" onClick={() => setSearch("")}>
                    Clear search
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-muted-foreground mb-2">No students yet</p>
                  <p className="text-sm text-muted-foreground mb-4">
                    Invite one to get started.
                  </p>
                  <Button asChild size="sm" variant="outline">
                    <Link href="/admin/students/invite">Invite a student</Link>
                  </Button>
                </>
              )}
            </div>
          ) : (
            <ul className="divide-y rounded-md border">
              {students.map((s, idx) => (
                <li key={s.userId || idx} className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">{primaryLabel(s)}</div>
                      {fullName(s) && s.email && (
                        <div className="text-xs text-muted-foreground break-all">{s.email}</div>
                      )}
                      <div
                        className="text-xs text-muted-foreground/70 font-mono break-all"
                        title={
                          isClerkUserId(s.userId)
                            ? "Clerk user ID (for debugging)"
                            : "Internal user identifier (not yet synced to Clerk)"
                        }
                      >
                        {isClerkUserId(s.userId) ? "Clerk ID" : "Internal ID"}: {s.userId}
                      </div>
                      {(s.sessionPacks ?? []).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {(s.sessionPacks ?? []).map((pack) => (
                            <Badge key={pack.id} variant={getStatusColor(pack.status)} className="text-xs">
                              {pack.instructorName || pack.instructorId}: {pack.remainingSessions}/{pack.totalSessions} remaining
                              {pack.expiresAt && ` (expires ${new Date(pack.expiresAt).toLocaleDateString()})`}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleOpenAddSessions(s)}
                    >
                      <UserPlus className="mr-2 h-4 w-4" />
                      Add Sessions
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Page {page} of {totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || isLoading}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages || isLoading}
                >
                  Next
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={addSessionsOpen} onOpenChange={setAddSessionsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Sessions to Student</DialogTitle>
            <DialogDescription>
              Add session pack to {selectedStudent ? primaryLabel(selectedStudent) : "student"} without payment flow.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {selectedStudent && (
              <div className="text-sm text-muted-foreground">
                Student: <span className="font-medium text-foreground">{primaryLabel(selectedStudent)}</span>
                <br />
                Email: {selectedStudent.email || "N/A"}
                <br />
                <span className="font-mono break-all">
                  {isClerkUserId(selectedStudent.userId) ? "Clerk ID" : "Internal ID"}: {selectedStudent.userId}
                </span>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="instructor">Instructor</Label>
              <Select
                value={selectedInstructorId || "__none__"}
                onValueChange={(v) => setSelectedInstructorId(v === "__none__" ? "" : v)}
                disabled={addSessionsMutation.isPending || isLoadingInstructors}
              >
                <SelectTrigger id="instructor" className="w-full">
                  <SelectValue placeholder="Select an instructor..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select an instructor...</SelectItem>
                  {(instructorsData?.instructors ?? []).map((inst) => (
                    <SelectItem key={inst.id} value={inst.id}>
                      {inst.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="totalSessions">Number of Sessions</Label>
              <Input
                id="totalSessions"
                type="number"
                min="1"
                value={totalSessions}
                onChange={(e) => setTotalSessions(e.target.value)}
                disabled={addSessionsMutation.isPending}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="expiresAt">Expiration Date (Optional)</Label>
              <Input
                id="expiresAt"
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                disabled={addSessionsMutation.isPending}
              />
            </div>

            {addError && (
              <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{addError}</div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAddSessionsOpen(false)}
              disabled={addSessionsMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddSessions}
              disabled={addSessionsMutation.isPending || !selectedInstructorId || !totalSessions}
            >
              {addSessionsMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Adding...
                </>
              ) : (
                "Add Sessions"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
