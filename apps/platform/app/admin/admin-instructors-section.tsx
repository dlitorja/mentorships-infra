"use client";

import { useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  getAdminInstructors,
  getAdminInstructorStudents,
  updateAdminInstructor,
  ApiFetchError,
} from "@/lib/queries/api-client";

function formatDate(dateString: string | null): string {
  if (!dateString) return "N/A";
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
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

type AdminStudent = {
  id: string;
  userId: string;
  email: string | null;
  instructorId: string;
  instructorName: string | null;
  instructorSlug: string | null;
  totalSessions: number;
  remainingSessions: number;
  purchasedAt: number;
  expiresAt: number | null;
  status: "active" | "depleted" | "expired" | "refunded";
  createdAt: number;
};

type InstructorWithStats = {
  instructorId: string;
  userId: string;
  email: string;
  oneOnOneInventory: number;
  groupInventory: number;
  maxActiveStudents: number;
  activeStudentCount: number;
  productActiveOneOnOne?: boolean;
  productActiveGroup?: boolean;
  createdAt: string;
};

function StudentsTable({ students }: { students: AdminStudent[] }) {
  if (students.length === 0) {
    return (
      <div className="text-center py-4">
        <p className="text-muted-foreground text-sm">No students assigned yet</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="text-left py-2 px-3 font-medium">Email</th>
            <th className="text-left py-2 px-3 font-medium">Sessions</th>
            <th className="text-left py-2 px-3 font-medium">Status</th>
            <th className="text-left py-2 px-3 font-medium">Last Session</th>
            <th className="text-left py-2 px-3 font-medium">Expiration</th>
          </tr>
        </thead>
        <tbody>
          {students.map((student) => (
            <tr key={student.id} className="border-b">
              <td className="py-2 px-3">{student.email ?? "(unknown)"}</td>
              <td className="py-2 px-3">
                {student.remainingSessions} / {student.totalSessions}
              </td>
              <td className="py-2 px-3">
                <Badge variant={getStatusBadgeVariant(student.status)}>{student.status}</Badge>
              </td>
              <td className="py-2 px-3">
                {formatDate(new Date(student.purchasedAt).toISOString())}
              </td>
              <td className="py-2 px-3">
                {student.expiresAt ? formatDate(new Date(student.expiresAt).toISOString()) : "No expiration"}
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
  students,
  onInventoryUpdated,
}: {
  instructor: InstructorWithStats;
  isExpanded: boolean;
  onToggle: () => void;
  students: AdminStudent[] | null;
  onInventoryUpdated: (
    id: string,
    updates: Partial<Pick<InstructorWithStats, "oneOnOneInventory" | "groupInventory" | "maxActiveStudents">>
  ) => void;
}) {
  const [oneOnOne, setOneOnOne] = useState<number>(instructor.oneOnOneInventory);
  const [group, setGroup] = useState<number>(instructor.groupInventory);
  const [maxStudents, setMaxStudents] = useState<number>(instructor.maxActiveStudents);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    oneOnOne !== instructor.oneOnOneInventory ||
    group !== instructor.groupInventory ||
    maxStudents !== instructor.maxActiveStudents;

  async function saveInventory() {
    setSaving(true);
    setError(null);
    try {
      await updateAdminInstructor(
        instructor.instructorId,
        {
          oneOnOneInventory: oneOnOne,
          groupInventory: group,
          maxActiveStudents: maxStudents,
        },
        false
      );
      onInventoryUpdated(instructor.instructorId, {
        oneOnOneInventory: oneOnOne,
        groupInventory: group,
        maxActiveStudents: maxStudents,
      });
    } catch (e) {
      if (
        e instanceof ApiFetchError &&
        typeof e.data === "object" &&
        e.data !== null &&
        "error" in e.data &&
        typeof e.data.error === "string"
      ) {
        setError(e.data.error);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <tr className="border-b hover:bg-muted/30 cursor-pointer" onClick={onToggle}>
        <td className="py-3 px-4">
          <div className="flex items-center gap-2">
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <span className="font-medium">{instructor.email}</span>
          </div>
        </td>
        <td className="py-3 px-4">
          <div className="flex items-center gap-2">
            <input
              className="w-16 border rounded px-2 py-1 text-sm bg-input text-foreground"
              type="number"
              min={0}
              max={999}
              value={oneOnOne}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                const raw = e.target.value;
                const n = parseInt(raw, 10);
                const clamped = Number.isNaN(n) ? 0 : Math.max(0, Math.min(999, n));
                setOneOnOne(clamped);
              }}
            />
            <Badge variant={instructor.productActiveOneOnOne ? "default" : "secondary"}>
              {instructor.productActiveOneOnOne ? "Active" : "Inactive"}
            </Badge>
          </div>
        </td>
        <td className="py-3 px-4">
          <div className="flex items-center gap-2">
            <input
              className="w-16 border rounded px-2 py-1 text-sm bg-input text-foreground"
              type="number"
              min={0}
              max={999}
              value={group}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                const raw = e.target.value;
                const n = parseInt(raw, 10);
                const clamped = Number.isNaN(n) ? 0 : Math.max(0, Math.min(999, n));
                setGroup(clamped);
              }}
            />
            <Badge variant={instructor.productActiveGroup ? "default" : "secondary"}>
              {instructor.productActiveGroup ? "Active" : "Inactive"}
            </Badge>
          </div>
        </td>
        <td className="py-3 px-4">
          <Badge variant={instructor.activeStudentCount > 0 ? "default" : "secondary"}>
            {instructor.activeStudentCount}
          </Badge>
        </td>
        <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-2">
            <input
              className="w-16 border rounded px-2 py-1 text-sm bg-input text-foreground"
              type="number"
              min={1}
              max={100}
              value={maxStudents}
              onChange={(e) => {
                const raw = e.target.value;
                const n = parseInt(raw, 10);
                const clamped = Number.isNaN(n) ? 1 : Math.max(1, Math.min(100, n));
                setMaxStudents(clamped);
              }}
            />
            <Button size="sm" variant="outline" disabled={!dirty || saving} onClick={saveInventory}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
          {error && <div className="text-xs text-red-600 mt-1">{error}</div>}
        </td>
      </tr>
      {isExpanded && (
        <tr className="bg-muted/30">
          <td colSpan={5} className="p-0">
            <div className="p-4">
              <h4 className="font-medium mb-3">Students ({students?.length || 0})</h4>
              {students ? (
                <StudentsTable students={students} />
              ) : (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function AdminInstructorsSection() {
  const { data: instructorsData } = useSuspenseQuery({
    queryKey: ["adminInstructors"],
    queryFn: () => getAdminInstructors(),
    staleTime: 1000 * 60,
  });

  const [instructors, setInstructors] = useState<InstructorWithStats[]>(
    instructorsData.instructors
  );
  const [expandedInstructorId, setExpandedInstructorId] = useState<string | null>(null);
  const [isAllExpanded, setIsAllExpanded] = useState(false);
  const [expandedStudents, setExpandedStudents] = useState<{ [key: string]: AdminStudent[] }>({});
  const [_loadingStudents, setLoadingStudents] = useState<string | null>(null);

  const handleToggleExpand = async (instructorId: string) => {
    if (isAllExpanded) {
      setExpandedInstructorId(expandedInstructorId === instructorId ? null : instructorId);
      return;
    }

    if (expandedInstructorId === instructorId) {
      setExpandedInstructorId(null);
      return;
    }

    setExpandedInstructorId(instructorId);

    if (!expandedStudents[instructorId]) {
      setLoadingStudents(instructorId);
      try {
        const json = await getAdminInstructorStudents(instructorId);
        const students = json.students || [];
        setExpandedStudents((prev) => ({ ...prev, [instructorId]: students }));
      } catch {
        setExpandedStudents((prev) => ({ ...prev, [instructorId]: [] }));
      } finally {
        setLoadingStudents(null);
      }
    }
  };

  const expandAll = async () => {
    setIsAllExpanded(true);
    for (const instructor of instructors) {
      if (!expandedStudents[instructor.instructorId]) {
        try {
          const json = await getAdminInstructorStudents(instructor.instructorId);
          const students = json.students || [];
          setExpandedStudents((prev) => ({ ...prev, [instructor.instructorId]: students }));
        } catch {
          setExpandedStudents((prev) => ({ ...prev, [instructor.instructorId]: [] }));
        }
      }
    }
  };

  const collapseAll = () => {
    setIsAllExpanded(false);
    setExpandedInstructorId(null);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Instructors</CardTitle>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={expandAll} disabled={isAllExpanded}>
            Expand All
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={collapseAll}
            disabled={!expandedInstructorId && !isAllExpanded}
          >
            Collapse All
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {instructors.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground mb-2">No instructors yet</p>
            <p className="text-sm text-muted-foreground">
              Instructors will appear once they complete onboarding
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-medium">Email</th>
                  <th className="text-left py-3 px-4 font-medium">1:1 Inventory / Product</th>
                  <th className="text-left py-3 px-4 font-medium">Group Inventory / Product</th>
                  <th className="text-left py-3 px-4 font-medium">Active Students</th>
                  <th className="text-left py-3 px-4 font-medium">Max Students / Save</th>
                </tr>
              </thead>
              <tbody>
                {instructors.map((instructor) => (
                  <InstructorRow
                    key={instructor.instructorId}
                    instructor={instructor}
                    isExpanded={isAllExpanded || expandedInstructorId === instructor.instructorId}
                    onToggle={() => handleToggleExpand(instructor.instructorId)}
                    students={expandedStudents[instructor.instructorId] || null}
                    onInventoryUpdated={(id, updates) => {
                      setInstructors((prev) =>
                        prev.map((i) => (i.instructorId === id ? { ...i, ...updates } : i))
                      );
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
