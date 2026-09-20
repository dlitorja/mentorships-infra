"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users } from "lucide-react";

export function AdminInstructorsSection(): React.JSX.Element {
  const result = useQuery(api.admin.getInstructorsForAdmin, { pageSize: 5 });
  const items = (result?.items ?? []).filter((i) => i.isActive);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Recent Instructors
        </CardTitle>
        <Link href="/admin/instructors">
          <Button variant="outline" size="sm">
            View All
          </Button>
        </Link>
      </CardHeader>
      <CardContent>
        {!result ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No instructors yet.</p>
        ) : (
          <div className="divide-y">
            {items.map((instructor) => (
              <div
                key={instructor.id}
                className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">
                    {instructor.name ?? instructor.email ?? "Unnamed"}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {instructor.email ?? "no email"}
                  </p>
                </div>
                <div className="text-right text-xs text-muted-foreground ml-4">
                  <p>{instructor.activeStudentCount} active students</p>
                  <p>{instructor.totalCompletedSessions} sessions</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
