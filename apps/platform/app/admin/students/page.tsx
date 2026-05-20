"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, Plus } from "lucide-react";
import { apiFetch } from "@/lib/queries/api-client";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";

type StudentItem = {
  id?: string;
  userId?: string;
  email?: string;
  firstName?: string | null;
  lastName?: string | null;
  // Additional fields may be present but are not required for listing
  [key: string]: unknown;
};

const StudentItemSchema = z.object({
  id: z.string().optional(),
  userId: z.string().optional(),
  email: z.string().optional(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
}).catchall(z.unknown());

const StudentsResponseSchema = z.object({
  items: z.array(StudentItemSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

type StudentsResponse = z.infer<typeof StudentsResponseSchema>;

/** Fetch students with runtime validation to guard API contract drift. */
async function fetchStudents(search?: string): Promise<StudentsResponse> {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  const data = await apiFetch<unknown>(`/api/admin/students?${params.toString()}`);
  return StudentsResponseSchema.parse(data);
}

export default function StudentsPage(): React.JSX.Element {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-students", debouncedSearch],
    queryFn: () => fetchStudents(debouncedSearch || undefined),
  });

  const students = data?.items ?? [];

  const displayName = (s: StudentItem) => {
    const name = [s.firstName, s.lastName].filter(Boolean).join(" ").trim();
    if (name) return name;
    return s.email || s.userId || "Unknown";
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
                  <div className="font-medium">{displayName(s)}</div>
                  <div className="text-sm text-muted-foreground">{s.email || s.userId}</div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
