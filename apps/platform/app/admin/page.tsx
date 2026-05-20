"use client";

import { useState, useEffect } from "react";
import { z } from "zod";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { 
  Users,
  ChevronDown,
  ChevronRight,
  ArrowUpDown
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Stats = {
  totalActiveStudents: number;
  revenueThisMonth: number;
  revenueLastMonth: number;
  revenueChange: number;
  revenueThisYear: number;
  hasRevenueData: boolean;
  hasStudentData: boolean;
  hasHistoricalRevenue: boolean;
};

type InstructorWithStats = {
  instructorId: string;
  userId: string;
  email: string;
  oneOnOneInventory: number;
  groupInventory: number;
  maxActiveStudents: number;
  activeStudentCount: number;
  createdAt: string;
};

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

type _InstructorWithStudents = InstructorWithStats & { students: AdminStudent[] };

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

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
                <Badge variant={getStatusBadgeVariant(student.status)}>
                  {student.status}
                </Badge>
              </td>
              <td className="py-2 px-3">
                {/* No last completed info available in admin query; show purchase date */}
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
  students 
}: { 
  instructor: InstructorWithStats;
  isExpanded: boolean;
  onToggle: () => void;
  students: AdminStudent[] | null;
}) {
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
        <td className="py-3 px-4">{instructor.oneOnOneInventory}</td>
        <td className="py-3 px-4">{instructor.groupInventory}</td>
        <td className="py-3 px-4">
          <Badge variant={instructor.activeStudentCount > 0 ? "default" : "secondary"}>
            {instructor.activeStudentCount}
          </Badge>
        </td>
        <td className="py-3 px-4">
          <span className="text-muted-foreground">-</span>
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

export default function AdminDashboard() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [instructors, setInstructors] = useState<InstructorWithStats[]>([]);
  const [expandedInstructorId, setExpandedInstructorId] = useState<string | null>(null);
  const [isAllExpanded, setIsAllExpanded] = useState(false);
  const [expandedStudents, setExpandedStudents] = useState<{ [key: string]: AdminStudent[] }>({});
  const [_loadingStudents, setLoadingStudents] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const [statsRes, instructorsRes] = await Promise.all([
          fetch("/api/admin/stats"),
          fetch("/api/admin/instructors"),
        ]);

        if (!statsRes.ok || !instructorsRes.ok) {
          const status = !statsRes.ok ? statsRes.status : instructorsRes.status;
          console.error(`Auth check failed - status: ${status}`);
          setError(status === 401 ? "Session expired. Please refresh." : "Failed to load admin data.");
          return;
        }

        const statsData = await statsRes.json();
        const instructorsData = await instructorsRes.json();

        if (statsData.totalActiveStudents !== undefined) {
          setStats(statsData);
        }

        if (instructorsData.instructors) {
          setInstructors(instructorsData.instructors);
        }
      } catch (err) {
        console.error("Error fetching dashboard data:", err);
        setError("Failed to load admin data. Please try again.");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const handleToggleExpand = async (instructorId: string) => {
    // If in "all expanded" mode, clicking a row toggles just that row
    if (isAllExpanded) {
      setExpandedInstructorId(expandedInstructorId === instructorId ? null : instructorId);
      return;
    }

    // Normal toggle behavior
    if (expandedInstructorId === instructorId) {
      setExpandedInstructorId(null);
      return;
    }

    setExpandedInstructorId(instructorId);

    if (!expandedStudents[instructorId]) {
      setLoadingStudents(instructorId);
      try {
        const res = await fetch(`/api/admin/instructors/${instructorId}/students`);
        const StudentSchema = z.object({
          id: z.string(),
          userId: z.string(),
          email: z.string().nullable(),
          instructorId: z.string(),
          instructorName: z.string().nullable(),
          instructorSlug: z.string().nullable(),
          totalSessions: z.number(),
          remainingSessions: z.number(),
          purchasedAt: z.number(),
          expiresAt: z.number().nullable(),
          status: z.enum(["active", "depleted", "expired", "refunded"]),
          createdAt: z.number(),
        });
        const StudentsPayload = z.object({ students: z.array(StudentSchema).optional() });

        if (!res.ok) {
          console.error(`Failed to load students for ${instructorId}: HTTP ${res.status}`);
          setExpandedStudents((prev) => ({ ...prev, [instructorId]: [] }));
        } else {
          const json = await res.json();
          const parsed = StudentsPayload.safeParse(json);
          const students: AdminStudent[] = parsed.success && parsed.data.students ? parsed.data.students : [];
          setExpandedStudents((prev) => ({ ...prev, [instructorId]: students }));
        }
      } catch (error) {
        console.error("Error loading students:", error);
        setExpandedStudents((prev) => ({ ...prev, [instructorId]: [] }));
      } finally {
        setLoadingStudents(null);
      }
    }
  };

  const expandAll = async () => {
    setIsAllExpanded(true);
    // Load all students for all instructors
    for (const instructor of instructors) {
      if (!expandedStudents[instructor.instructorId]) {
        try {
          const res = await fetch(`/api/admin/instructors/${instructor.instructorId}/students`);
          const StudentSchema = z.object({
            id: z.string(),
            userId: z.string(),
            email: z.string().nullable(),
            instructorId: z.string(),
            instructorName: z.string().nullable(),
            instructorSlug: z.string().nullable(),
            totalSessions: z.number(),
            remainingSessions: z.number(),
            purchasedAt: z.number(),
            expiresAt: z.number().nullable(),
            status: z.enum(["active", "depleted", "expired", "refunded"]),
            createdAt: z.number(),
          });
          const StudentsPayload = z.object({ students: z.array(StudentSchema).optional() });

          if (!res.ok) {
            console.error(`Failed to load students for ${instructor.instructorId}: HTTP ${res.status}`);
            setExpandedStudents((prev) => ({ ...prev, [instructor.instructorId]: [] }));
          } else {
            const json = await res.json();
            const parsed = StudentsPayload.safeParse(json);
            const students: AdminStudent[] = parsed.success && parsed.data.students ? parsed.data.students : [];
            setExpandedStudents((prev) => ({ ...prev, [instructor.instructorId]: students }));
          }
        } catch (error) {
          console.error("Error loading students:", error);
          setExpandedStudents((prev) => ({ ...prev, [instructor.instructorId]: [] }));
        }
      }
    }
  };

  const collapseAll = () => {
    setIsAllExpanded(false);
    setExpandedInstructorId(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <div className="text-muted-foreground">{error}</div>
        <Button variant="outline" onClick={() => router.refresh()}>
          Refresh Page
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold">Admin Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Overview of your mentorship platform
          </p>
        </div>

        {/* Stats Overview */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card className={stats && !stats.hasStudentData ? "opacity-60" : ""}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Active Students
              </CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {stats?.hasStudentData ? (
                <div className="text-2xl font-bold">
                  {stats.totalActiveStudents}
                </div>
              ) : (
                <div className="text-2xl font-bold text-muted-foreground">
                  No students yet
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Revenue (This Month)
              </CardTitle>
              <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {stats ? formatCurrency(stats.revenueThisMonth) : "-"}
              </div>
            </CardContent>
          </Card>

          <Card className={stats && !stats.hasHistoricalRevenue ? "opacity-60" : ""}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Revenue Change
              </CardTitle>
              <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {stats?.hasHistoricalRevenue ? (
                <>
                  <div className={cn(
                    "text-2xl font-bold",
                    stats.revenueChange > 0 ? "text-green-600" : 
                    stats.revenueChange < 0 ? "text-red-600" : ""
                  )}>
                    {stats.revenueChange > 0 
                      ? `+${stats.revenueChange.toFixed(1)}%`
                      : `${stats.revenueChange.toFixed(1)}%`}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    vs last month
                  </p>
                </>
              ) : (
                <>
                  <div className="text-2xl font-bold text-muted-foreground">
                    No prior data
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Need more data to compare
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Revenue (This Year)
              </CardTitle>
              <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {stats ? formatCurrency(stats.revenueThisYear) : "-"}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              <Link href="/admin/products/create">
                <Button variant="outline">Create New Product</Button>
              </Link>
              <Link href="/admin/orders">
                <Button variant="outline">View All Orders</Button>
              </Link>
              <Link href="/admin/products">
                <Button variant="outline">Manage Products</Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Instructors Table */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Instructors</CardTitle>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm"
                onClick={expandAll}
                disabled={isAllExpanded}
              >
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
                      <th className="text-left py-3 px-4 font-medium">1:1 Inventory</th>
                      <th className="text-left py-3 px-4 font-medium">Group Inventory</th>
                      <th className="text-left py-3 px-4 font-medium">Active Students</th>
                      <th className="text-left py-3 px-4 font-medium">Revenue (Month)</th>
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
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
  );
}
