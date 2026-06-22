"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Calendar, UserPlus } from "lucide-react";
import { apiFetch } from "@/lib/queries/api-client";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
  id?: string;
  userId?: string;
  email?: string;
  firstName?: string | null;
  lastName?: string | null;
  sessionPacks?: Array<{
    id: string;
    instructorId: string;
    instructorName?: string;
    totalSessions: number;
    remainingSessions: number;
    status: string;
    expiresAt?: string | null;
  }>;
  [key: string]: unknown;
};

const SessionPackSchema = z.object({
  id: z.string(),
  instructorId: z.string(),
  instructorName: z.string().optional(),
  totalSessions: z.number(),
  remainingSessions: z.number(),
  status: z.string(),
  expiresAt: z.string().nullable().optional(),
});

const StudentItemSchema = z.object({
  id: z.string().optional(),
  userId: z.string().optional(),
  email: z.string().optional(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  sessionPacks: z.array(SessionPackSchema).default([]),
}).catchall(z.unknown());

const StudentsResponseSchema = z.object({
  items: z.array(StudentItemSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

type StudentsResponse = z.infer<typeof StudentsResponseSchema>;

async function fetchStudents(search?: string): Promise<StudentsResponse> {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  const data = await apiFetch<unknown>(`/api/admin/students?${params.toString()}`);
  return StudentsResponseSchema.parse(data);
}

async function fetchInstructors() {
  return apiFetch<{ items: { id: string; name: string; slug: string }[] }>("/api/admin/instructors?includeInactive=true");
}

async function addSessionsToStudent(userId: string, data: { instructorId: string; totalSessions: number; expiresAt?: string }) {
  const response = await fetch(`/api/admin/students/${userId}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to add sessions");
  }
  return response.json();
}

export default function StudentsPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [addSessionsOpen, setAddSessionsOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<StudentItem | null>(null);
  const [selectedInstructorId, setSelectedInstructorId] = useState("");
  const [totalSessions, setTotalSessions] = useState("4");
  const [expiresAt, setExpiresAt] = useState("");
  const [addError, setAddError] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-students", debouncedSearch],
    queryFn: () => fetchStudents(debouncedSearch || undefined),
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
      setTotalSessions("4");
      setExpiresAt("");
      setAddError("");
    },
    onError: (err) => {
      setAddError(err instanceof Error ? err.message : "Failed to add sessions");
    },
  });

  const students = data?.items ?? [];

  const displayName = (s: StudentItem) => {
    const name = [s.firstName, s.lastName].filter(Boolean).join(" ").trim();
    if (name) return name;
    return s.email || s.userId || "Unknown";
  };

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
          <p className="text-sm text-muted-foreground">View and manage students. Use search to filter by name or email.</p>
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
            <CardDescription>Showing {students.length} result{students.length === 1 ? "" : "s"}</CardDescription>
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
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : error ? (
            <div className="text-sm text-red-500">Failed to load students</div>
          ) : students.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">No students found</div>
          ) : (
            <ul className="divide-y rounded-md border">
              {students.map((s, idx) => (
                <li key={(s.userId as string) || (s.id as string) || idx} className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">{displayName(s)}</div>
                      <div className="text-sm text-muted-foreground">{s.email || s.userId}</div>
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
        </CardContent>
      </Card>

      <Dialog open={addSessionsOpen} onOpenChange={setAddSessionsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Sessions to Student</DialogTitle>
            <DialogDescription>
              Add session pack to {selectedStudent ? displayName(selectedStudent) : "student"} without payment flow.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {selectedStudent && (
              <div className="text-sm text-muted-foreground">
                Student: <span className="font-medium text-foreground">{displayName(selectedStudent)}</span>
                <br />
                Email: {selectedStudent.email || "N/A"}
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
                  {instructorsData?.items.map((inst) => (
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
