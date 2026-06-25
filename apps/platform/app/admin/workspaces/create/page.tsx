"use client";

import React, { use, useState } from "react";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loader2, ArrowLeft, User, Users } from "lucide-react";
import Link from "next/link";
import { apiFetch } from "@/lib/queries/api-client";

type StudentItem = {
  kind: "student";
  id: string;
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
};

type InstructorItem = {
  kind: "instructor";
  id: string;
  userId: string;
  name?: string;
  email?: string;
};

type SelectableItem = StudentItem | InstructorItem;

/** Type guard that narrows a SelectableItem to StudentItem. */
function isStudentItem(item: SelectableItem): item is StudentItem {
  return item.kind === "student";
}

/** Fetches mentees from the admin API, optionally filtered by search. */
async function fetchUsers(search?: string): Promise<{ items: StudentItem[] }> {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  params.set("includeInactive", "true");
  
  return apiFetch<{ items: StudentItem[] }>(`/api/admin/students?${params.toString()}`);
}

/** Fetches all instructors from the admin API. */
async function fetchInstructors(): Promise<{ items: InstructorItem[] }> {
  return apiFetch<{ items: InstructorItem[] }>("/api/admin/instructors?includeInactive=true");
}

/** Creates an admin-student workspace and returns the result. */
async function createAdminStudentWorkspace(data: {
  studentUserId: string;
  name?: string;
  description?: string;
  isPublic?: boolean;
}) {
  const response = await fetch("/api/admin/workspaces/admin-student", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to create workspace");
  }
  return response.json();
}

/** Creates an admin-instructor workspace and returns the result. */
async function createAdminInstructorWorkspace(data: {
  instructorId: string;
  name?: string;
  description?: string;
  isPublic?: boolean;
}) {
  const response = await fetch("/api/admin/workspaces/admin-instructor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to create workspace");
  }
  return response.json();
}

/** Page for creating admin workspaces (student or instructor type). */
export default function CreateWorkspacePage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const resolvedSearchParams = use(searchParams);
  const router = useRouter();
  const workspaceType = resolvedSearchParams.type || "admin_student";
  
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [customName, setCustomName] = useState("");
  const [customDescription, setCustomDescription] = useState("");
  const [customIsPublic, setCustomIsPublic] = useState(false);

  const { data: usersData, isLoading: loadingUsers } = useQuery({
    queryKey: ["users", debouncedSearch],
    queryFn: () => fetchUsers(debouncedSearch),
    enabled: workspaceType === "admin_student",
  });

  const { data: instructorsData, isLoading: loadingInstructors } = useQuery({
    queryKey: ["instructors"],
    queryFn: fetchInstructors,
    enabled: workspaceType === "admin_instructor",
  });

  const createStudentMutation = useMutation({
    mutationFn: createAdminStudentWorkspace,
    onSuccess: (data) => {
      router.push(`/admin/workspaces/${data.id}`);
    },
  });

  const createInstructorMutation = useMutation({
    mutationFn: createAdminInstructorWorkspace,
    onSuccess: (data) => {
      router.push(`/admin/workspaces/${data.id}`);
    },
  });

  const handleCreate = () => {
    if (!selectedUserId) return;

    const trimmedName = customName.trim() || undefined;
    const trimmedDescription = customDescription.trim() || undefined;

    const workspaceData = {
      name: trimmedName,
      description: trimmedDescription,
      isPublic: customIsPublic || undefined,
    };

    if (workspaceType === "admin_student") {
      createStudentMutation.mutate({ studentUserId: selectedUserId, ...workspaceData });
    } else {
      createInstructorMutation.mutate({ instructorId: selectedUserId, ...workspaceData });
    }
  };

  const isLoading = workspaceType === "admin_student" ? loadingUsers : loadingInstructors;
  const isCreating = createStudentMutation.isPending || createInstructorMutation.isPending;
  const isSearching = search !== debouncedSearch;
const items = workspaceType === "admin_student" 
    ? usersData?.items || [] 
    : instructorsData?.items || [];

  return (
    <div className="container mx-auto py-8">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin/workspaces">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">
            Create {workspaceType === "admin_student" ? "Admin-Student" : "Admin-Instructor"} Workspace
          </h1>
          <p className="text-muted-foreground">
            Select a user to create a private workspace for admin communication
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {workspaceType === "admin_student" ? (
                <>
                  <User className="h-5 w-5" />
                  Select Student
                </>
              ) : (
                <>
                  <Users className="h-5 w-5" />
                  Select Instructor
                </>
              )}
            </CardTitle>
            <CardDescription>
              {workspaceType === "admin_student" 
                ? "Choose a student to create a private workspace with" 
                : "Choose an instructor to create a private workspace with"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              placeholder="Search users..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : (
              <div className={`max-h-96 overflow-y-auto space-y-2 ${isSearching ? "opacity-50" : ""}`}>
                {items.map((item) => {
                  const itemId = workspaceType === "admin_student" ? item.userId : item.id;
                  const displayName = isStudentItem(item) 
                    ? (item.firstName || item.email || item.userId)
                    : (item.name || item.email || item.userId.slice(0, 8));
                  
                  return (
                    <div
                      key={itemId}
                      className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                        selectedUserId === itemId
                          ? "border-primary bg-primary/5"
                          : "hover:border-muted-foreground"
                      }`}
                      onClick={() => setSelectedUserId(itemId)}
                    >
                      <div className="font-medium">{displayName}</div>
                      {isStudentItem(item) && item.email && (
                        <div className="text-sm text-muted-foreground">{item.email}</div>
                      )}
                    </div>
                  );
                })}
                {items.length === 0 && (
                  <p className="text-center text-muted-foreground py-4">
                    No users found
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Create Workspace</CardTitle>
            <CardDescription>
              Review and create the workspace
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 bg-muted rounded-lg">
              <div className="text-sm font-medium text-muted-foreground">Workspace Type</div>
              <div className="text-lg font-semibold">
                {workspaceType === "admin_student" ? "Admin-Student" : "Admin-Instructor"}
              </div>
            </div>

            <div className="p-4 bg-muted rounded-lg">
              <div className="text-sm font-medium text-muted-foreground">Selected User</div>
              <div className="text-lg font-semibold">
                {selectedUserId ? (
                  workspaceType === "admin_student"
                    ? usersData?.items.find((u: StudentItem) => u.userId === selectedUserId)?.email || selectedUserId
                    : instructorsData?.items.find((i) => i.id === selectedUserId)?.name || selectedUserId
                ) : (
                  <span className="text-muted-foreground">None selected</span>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="workspaceName">Workspace Name (optional)</Label>
              <Input
                id="workspaceName"
                placeholder="Leave blank for auto-generated name"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="workspaceDescription">Description (optional)</Label>
              <Input
                id="workspaceDescription"
                placeholder="Brief description of workspace purpose"
                value={customDescription}
                onChange={(e) => setCustomDescription(e.target.value)}
              />
            </div>

            <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
              <div>
                <div className="text-sm font-medium" id="visibility-label">Visibility</div>
                <div className="text-sm text-muted-foreground">
                  {customIsPublic ? "Public - visible with link" : "Private - admin and user only"}
                </div>
              </div>
              <Switch
                checked={customIsPublic}
                onCheckedChange={setCustomIsPublic}
                aria-labelledby="visibility-label"
              />
            </div>

            <Button
              className="w-full"
              onClick={handleCreate}
              disabled={!selectedUserId || isCreating}
            >
              {isCreating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Workspace"
              )}
            </Button>

            {createStudentMutation.error && (
              <p className="text-sm text-red-500">
                {createStudentMutation.error.message}
              </p>
            )}
            {createInstructorMutation.error && (
              <p className="text-sm text-red-500">
                {createInstructorMutation.error.message}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
