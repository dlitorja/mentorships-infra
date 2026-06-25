"use client";

import React, { use, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, ArrowLeft, User, Users, Save } from "lucide-react";
import { apiFetch } from "@/lib/queries/api-client";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";

type WorkspaceMember = {
  id: string;
  name: string;
  description: string | null;
  type: "mentorship" | "admin_student" | "admin_instructor";
  ownerId: string;
  owner: { userId: string; email: string; firstName: string | null } | null;
  instructorId: string | null;
  instructor: { id: string; userId: string; bio: string | null } | null;
};

type StudentItem = {
  id: string;
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
};

type InstructorItem = {
  id: string;
  userId: string;
  name?: string;
  email?: string;
};

async function fetchWorkspace(id: string): Promise<WorkspaceMember> {
  return apiFetch<WorkspaceMember>(`/api/admin/workspaces/${id}`);
}

async function fetchStudents(search?: string): Promise<{ items: StudentItem[] }> {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  params.set("includeInactive", "true");
  return apiFetch<{ items: StudentItem[] }>(`/api/admin/students?${params.toString()}`);
}

async function fetchInstructors(): Promise<{ items: InstructorItem[] }> {
  return apiFetch<{ items: InstructorItem[] }>("/api/admin/instructors?includeInactive=true");
}

async function updateWorkspaceMember(
  workspaceId: string,
  data: { newOwnerId?: string; newInstructorId?: string | null }
) {
  const response = await fetch(`/api/admin/workspaces/${workspaceId}/members`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to update workspace member");
  }
  return response.json();
}

export default function WorkspaceMembersPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const workspaceId = resolvedParams.id;
  const queryClient = useQueryClient();

  const [ownerSearch, setOwnerSearch] = useState("");
  const debouncedOwnerSearch = useDebouncedValue(ownerSearch, 300);
  const [selectedNewOwnerId, setSelectedNewOwnerId] = useState<string | null>(null);
  const [selectedNewInstructorId, setSelectedNewInstructorId] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(false);

  const { data: workspace, isLoading, error } = useQuery({
    queryKey: ["admin-workspace", workspaceId],
    queryFn: () => fetchWorkspace(workspaceId),
  });

  const { data: studentsData, isLoading: loadingStudents } = useQuery({
    queryKey: ["admin-students-search", debouncedOwnerSearch],
    queryFn: () => fetchStudents(debouncedOwnerSearch),
    enabled: debouncedOwnerSearch.length > 0,
  });

  const { data: instructorsData } = useQuery({
    queryKey: ["admin-instructors"],
    queryFn: fetchInstructors,
  });

  const updateMutation = useMutation({
    mutationFn: (data: { newOwnerId?: string; newInstructorId?: string | null }) =>
      updateWorkspaceMember(workspaceId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-workspace", workspaceId] });
      setSelectedNewOwnerId(null);
      setSelectedNewInstructorId(null);
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    },
  });

  const handleSaveOwner = () => {
    if (selectedNewOwnerId) {
      updateMutation.mutate({ newOwnerId: selectedNewOwnerId });
    }
  };

  const handleSaveInstructor = () => {
    updateMutation.mutate({ newInstructorId: selectedNewInstructorId });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (error || !workspace) {
    return (
      <div className="container mx-auto py-8">
        <div className="text-center text-destructive">
          Failed to load workspace: {error?.message || "Not found"}
        </div>
      </div>
    );
  }

  const showInstructorSection = workspace.type === "mentorship" || workspace.type === "admin_instructor";
  const canChangeOwner = true;
  const canChangeInstructor = workspace.type !== "admin_student";

  return (
    <div className="container mx-auto py-8">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/admin/workspaces/${workspaceId}`}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Workspace Members</h1>
          <p className="text-muted-foreground">
            Manage ownership and instructor assignment for {workspace.name}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Owner
            </CardTitle>
            <CardDescription>
              The student who owns this workspace
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 bg-muted rounded-lg">
              <div className="text-sm text-muted-foreground">Current Owner</div>
              <div className="font-medium">
                {workspace.owner?.firstName || "Unknown"}
              </div>
              <div className="text-sm text-muted-foreground">
                {workspace.owner?.email || workspace.ownerId}
              </div>
            </div>

            {canChangeOwner && (
              <div className="space-y-3">
                <Label>Transfer Ownership</Label>
                <Input
                  placeholder="Search by email..."
                  value={ownerSearch}
                  onChange={(e) => setOwnerSearch(e.target.value)}
                />
                {loadingStudents && ownerSearch && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Searching...
                  </div>
                )}
                {studentsData?.items && ownerSearch && (
                  <div className="max-h-48 overflow-y-auto border rounded-lg">
                    {studentsData.items.map((student) => (
                      <button
                        key={student.userId}
                        type="button"
                        className={`w-full text-left p-3 cursor-pointer hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring ${
                          selectedNewOwnerId === student.userId ? "bg-primary/10" : ""
                        }`}
                        onClick={() => setSelectedNewOwnerId(student.userId)}
                      >
                        <div className="font-medium">
                          {student.firstName || student.email}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {student.email}
                        </div>
                      </button>
                    ))}
                    {studentsData.items.length === 0 && (
                      <div className="p-3 text-center text-muted-foreground text-sm">
                        No students found
                      </div>
                    )}
                  </div>
                )}
                {selectedNewOwnerId && (
                  <Button onClick={handleSaveOwner} disabled={updateMutation.isPending}>
                    {updateMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" />
                        Transfer Ownership
                      </>
                    )}
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {showInstructorSection && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Instructor
              </CardTitle>
              <CardDescription>
                The instructor associated with this workspace
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 bg-muted rounded-lg">
                <div className="text-sm text-muted-foreground">Current Instructor</div>
                {workspace.instructor ? (
                  <div className="font-medium font-mono text-sm">
                    {workspace.instructor.userId.slice(0, 12)}...
                  </div>
                ) : (
                  <div className="text-muted-foreground">None assigned</div>
                )}
              </div>

              {canChangeInstructor && (
                <div className="space-y-3">
                  <Label>Change Instructor</Label>
                  <Select
                    value={selectedNewInstructorId || ""}
                    onValueChange={(v) => setSelectedNewInstructorId(v === "__none__" ? null : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select an instructor" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {instructorsData?.items.map((instructor) => (
                        <SelectItem key={instructor.id} value={instructor.id}>
                          {instructor.name || instructor.email || instructor.id.slice(0, 8)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedNewInstructorId && (
                    <Button onClick={handleSaveInstructor} disabled={updateMutation.isPending}>
                      {updateMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save className="mr-2 h-4 w-4" />
                          Update Instructor
                        </>
                      )}
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {updateMutation.error && (
        <div className="mt-6 text-sm text-destructive bg-destructive/10 p-3 rounded-md max-w-xl">
          {updateMutation.error.message}
        </div>
      )}

      {isSaved && (
        <div className="mt-6 text-sm text-green-600 bg-green-50 p-3 rounded-md max-w-xl">
          Member updated successfully
        </div>
      )}
    </div>
  );
}