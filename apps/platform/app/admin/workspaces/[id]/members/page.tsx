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
import { Loader2, ArrowLeft, User, Users, Save, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getAdminWorkspace, getAdminInstructors, getAdminStudents, updateAdminWorkspaceMembers } from "@/lib/queries/api-client";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { ClerkUserIdCell } from "@/components/admin/clerk-user-id-cell";
import { getClerkDashboardUserUrl } from "@/lib/clerk-dashboard-url";

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
  email: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

type InstructorItem = {
  id: string;
  userId: string;
  name?: string;
  email?: string;
};

async function fetchInstructors(): Promise<{ items: InstructorItem[] }> {
  const data = await getAdminInstructors({ includeInactive: true });
  return {
    items: data.instructors.map((inst) => ({
      id: inst.instructorId,
      userId: inst.userId,
      name: inst.displayName || inst.email,
    })),
  };
}

export default function WorkspaceMembersPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const workspaceId = resolvedParams.id;
  const queryClient = useQueryClient();

  const [ownerSearch, setOwnerSearch] = useState("");
  const debouncedOwnerSearch = useDebouncedValue(ownerSearch, 300);
  const [selectedNewOwnerId, setSelectedNewOwnerId] = useState<string | null>(null);
  const [selectedNewInstructorId, setSelectedNewInstructorId] = useState<string | null>(null);
  const [instructorHasBeenSelected, setInstructorHasBeenSelected] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  /** Set when the admin asks to transfer ownership; nothing happens until confirmed. */
  const [pendingOwner, setPendingOwner] = useState<{ userId: string; label: string } | null>(null);

  const { data: workspace, isLoading, error } = useQuery({
    queryKey: ["admin-workspace", workspaceId],
    queryFn: () => getAdminWorkspace(workspaceId) as Promise<WorkspaceMember>,
  });

  const { data: studentsData, isLoading: loadingStudents } = useQuery({
    queryKey: ["admin-students-search", debouncedOwnerSearch],
    queryFn: async () => {
      const result = await getAdminStudents({ search: debouncedOwnerSearch, includeInactive: true });
      return {
        items: result.items.map((student) => {
          const item: StudentItem = {
            id: student.userId,
            userId: student.userId,
            email: student.email,
          };
          return item;
        }),
      };
    },
    enabled: debouncedOwnerSearch.length > 0,
  });

  const { data: instructorsData } = useQuery({
    queryKey: ["admin-instructors"],
    queryFn: fetchInstructors,
  });

  const updateMutation = useMutation({
    mutationFn: (data: { newOwnerId?: string; newInstructorId?: string | null }) =>
      updateAdminWorkspaceMembers(workspaceId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-workspace", workspaceId] });
      setSelectedNewOwnerId(null);
      setSelectedNewInstructorId(null);
      setInstructorHasBeenSelected(false);
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    },
  });

  const handleSaveOwner = () => {
    if (selectedNewOwnerId) {
      const student = studentsData?.items.find((s) => s.userId === selectedNewOwnerId);
      setPendingOwner({
        userId: selectedNewOwnerId,
        label: student?.firstName || student?.email || selectedNewOwnerId,
      });
    }
  };

  const confirmOwnerTransfer = () => {
    if (!pendingOwner) return;
    updateMutation.mutate({ newOwnerId: pendingOwner.userId });
    setPendingOwner(null);
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

            {(
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
                {workspace.instructor?.userId ? (
                  <ClerkUserIdCell
                    id={workspace.instructor.userId}
                    truncateAt={12}
                    dashboardUrl={getClerkDashboardUserUrl(workspace.instructor.userId)}
                    label="Clerk user id"
                  />
                ) : workspace.instructor ? (
                  <div className="font-medium font-mono text-sm">-</div>
                ) : (
                  <div className="text-muted-foreground">None assigned</div>
                )}
              </div>

              {canChangeInstructor && (
                <div className="space-y-3">
                  <Label>Change Instructor</Label>
                  <Select
                    value={selectedNewInstructorId || ""}
                    onValueChange={(v) => {
                      setSelectedNewInstructorId(v === "__none__" ? null : v);
                      setInstructorHasBeenSelected(true);
                    }}
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
                  {instructorHasBeenSelected && (
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

      <Dialog open={!!pendingOwner} onOpenChange={(open) => !open && setPendingOwner(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              Transfer workspace ownership?
            </DialogTitle>
            <DialogDescription>
              Ownership moves from the current owner to{" "}
              <span className="font-medium text-foreground">{pendingOwner?.label}</span>. The
              workspace — including its messages and files — changes hands, and the previous owner
              loses access.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            Session packs, seat reservations and payments are <strong>not</strong> transferred. If
            the new owner has no sessions with this instructor, they will see the workspace without
            an entitlement — grant one from the student record after transferring.
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setPendingOwner(null)}>
              Cancel
            </Button>
            <Button
              onClick={confirmOwnerTransfer}
              disabled={updateMutation.isPending}
              className="bg-amber-600 text-white hover:bg-amber-700"
            >
              {updateMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Transferring...
                </>
              ) : (
                "Transfer ownership"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}