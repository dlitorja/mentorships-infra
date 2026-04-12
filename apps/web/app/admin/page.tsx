"use client";

import { useState, useEffect } from "react";
import { UserButton } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import Link from "next/link";
import { 
  LayoutDashboard, 
  Package,
  ShoppingCart,
  Users,
  ChevronDown,
  ChevronRight,
  ArrowUpDown
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

type Stats = {
  totalActiveMentees: number;
  revenueThisMonth: number;
  revenueLastMonth: number;
  revenueChange: number;
  revenueThisYear: number;
  hasRevenueData: boolean;
  hasMenteeData: boolean;
  hasHistoricalRevenue: boolean;
};

type InstructorWithStats = {
  mentorId: string;
  userId: string;
  email: string;
  oneOnOneInventory: number;
  groupInventory: number;
  maxActiveStudents: number;
  activeMenteeCount: number;
  createdAt: string;
};

type MenteeWithSessionInfo = {
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

type InstructorWithMentees = InstructorWithStats & {
  mentees: MenteeWithSessionInfo[];
};

const navItems = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/products", label: "Products", icon: Package },
  { href: "/admin/orders", label: "Orders", icon: ShoppingCart },
];

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

function MenteesTable({ mentees }: { mentees: MenteeWithSessionInfo[] }) {
  if (mentees.length === 0) {
    return (
      <div className="text-center py-4">
        <p className="text-muted-foreground text-sm">No mentees assigned yet</p>
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
          {mentees.map((mentee) => (
            <tr key={mentee.sessionPackId} className="border-b">
              <td className="py-2 px-3">{mentee.email}</td>
              <td className="py-2 px-3">
                {mentee.remainingSessions} / {mentee.totalSessions}
              </td>
              <td className="py-2 px-3">
                <Badge variant={getStatusBadgeVariant(mentee.status)}>
                  {mentee.status}
                </Badge>
              </td>
              <td className="py-2 px-3">
                {formatDateTime(mentee.lastSessionCompletedAt)}
              </td>
              <td className="py-2 px-3">
                {mentee.expiresAt ? formatDate(mentee.expiresAt) : "No expiration"}
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
  mentees 
}: { 
  instructor: InstructorWithStats;
  isExpanded: boolean;
  onToggle: () => void;
  mentees: MenteeWithSessionInfo[] | null;
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
          <Badge variant={instructor.activeMenteeCount > 0 ? "default" : "secondary"}>
            {instructor.activeMenteeCount}
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
              <h4 className="font-medium mb-3">Mentees ({mentees?.length || 0})</h4>
              {mentees ? (
                <MenteesTable mentees={mentees} />
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
  const pathname = "/admin";
  const [stats, setStats] = useState<Stats | null>(null);
  const [instructors, setInstructors] = useState<InstructorWithStats[]>([]);
  const [expandedMentorId, setExpandedMentorId] = useState<string | null>(null);
  const [expandedMentees, setExpandedMentees] = useState<{ [key: string]: MenteeWithSessionInfo[] }>({});
  const [loadingMentees, setLoadingMentees] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [statsRes, instructorsRes] = await Promise.all([
          fetch("/api/admin/stats"),
          fetch("/api/marketing/api/admin/instructors"),
        ]);

        const statsData = await statsRes.json();
        const instructorsData = await instructorsRes.json();

        if (statsData.totalActiveMentees !== undefined) {
          setStats(statsData);
        }

        if (instructorsData.instructors) {
          setInstructors(instructorsData.instructors);
        }
      } catch (error) {
        console.error("Error fetching dashboard data:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const handleToggleExpand = async (mentorId: string) => {
    if (expandedMentorId === mentorId) {
      setExpandedMentorId(null);
      return;
    }

    setExpandedMentorId(mentorId);

    if (!expandedMentees[mentorId]) {
      setLoadingMentees(mentorId);
      try {
        const res = await fetch(`/api/marketing/api/admin/instructors/${mentorId}/mentees`);
        const data = await res.json();
        if (data.mentees) {
          setExpandedMentees((prev) => ({ ...prev, [mentorId]: data.mentees }));
        }
      } catch (error) {
        console.error("Error loading mentees:", error);
      } finally {
        setLoadingMentees(null);
      }
    }
  };

  const expandAll = () => {
    setExpandedMentorId("all");
    instructors.forEach(async (instructor) => {
      if (!expandedMentees[instructor.mentorId]) {
        try {
          const res = await fetch(`/api/marketing/api/admin/instructors/${instructor.mentorId}/mentees`);
          const data = await res.json();
          if (data.mentees) {
            setExpandedMentees((prev) => ({ ...prev, [instructor.mentorId]: data.mentees }));
          }
        } catch (error) {
          console.error("Error loading mentees:", error);
        }
      }
    });
  };

  const collapseAll = () => {
    setExpandedMentorId(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-64 border-r bg-muted/30 min-h-screen p-4 flex flex-col">
        <div className="mb-8">
          <h2 className="text-xl font-bold">Admin Panel</h2>
          <p className="text-sm text-muted-foreground">Web App</p>
        </div>

        <nav className="space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || 
              (item.href !== "/admin" && pathname.startsWith(item.href));
            
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-4 py-2 transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                )}
              >
                <Icon className="h-5 w-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto pt-4 border-t">
          <div className="flex items-center gap-3 px-4 py-2">
            <UserButton />
          </div>
        </div>
      </aside>

      <main className="flex-1 p-8 space-y-8">
        <div>
          <h1 className="text-3xl font-bold">Admin Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Overview of your mentorship platform
          </p>
        </div>

        {/* Stats Overview */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card className={stats && !stats.hasMenteeData ? "opacity-60" : ""}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Active Mentees
              </CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {stats?.hasMenteeData ? (
                <div className="text-2xl font-bold">
                  {stats.totalActiveMentees}
                </div>
              ) : (
                <div className="text-2xl font-bold text-muted-foreground">
                  No mentees yet
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
                disabled={expandedMentorId === "all"}
              >
                Expand All
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                onClick={collapseAll}
                disabled={!expandedMentorId}
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
                      <th className="text-left py-3 px-4 font-medium">Active Mentees</th>
                      <th className="text-left py-3 px-4 font-medium">Revenue (Month)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {instructors.map((instructor) => (
                      <InstructorRow
                        key={instructor.mentorId}
                        instructor={instructor}
                        isExpanded={expandedMentorId === instructor.mentorId || expandedMentorId === "all"}
                        onToggle={() => handleToggleExpand(instructor.mentorId)}
                        mentees={expandedMentees[instructor.mentorId] || null}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}