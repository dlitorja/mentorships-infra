"use client";

export const dynamic = "force-dynamic";

import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Mail, Pause, PlusCircle, XCircle } from "lucide-react";

type AttentionData = FunctionReturnType<typeof api.packAttention.listPacksNeedingAttention>;
type Row = AttentionData["rows"][number];

function formatDate(value: number | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default function PacksWithSessionsPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const attentionQuery = convexQuery(api.packAttention.listPacksNeedingAttention, {});
  const { data, isLoading, error } = useQuery(attentionQuery);

  const pausePack = useMutation({
    mutationFn: useConvexMutation(api.packAttention.pausePack),
  });
  const closePack = useMutation({
    mutationFn: useConvexMutation(api.packAttention.closePack),
  });
  const addSeat = useMutation({
    mutationFn: useConvexMutation(api.instructors.incrementOneOnOneSeat),
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: attentionQuery.queryKey });

  async function contactStudent(row: Row) {
    try {
      const response = await fetch(`/api/admin/packs/${row.packId}/contact`, {
        method: "POST",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Failed to send email");
      toast.success(`Email sent to ${row.student.email ?? row.student.name}`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send email");
    }
  }

  async function pause(row: Row) {
    const raw = window.prompt("Pause for how many days?", "30");
    if (!raw) return;
    const days = Number(raw);
    if (!Number.isFinite(days) || days < 1) {
      toast.error("Enter a number of days");
      return;
    }
    try {
      await pausePack.mutateAsync({ packId: row.packId, days, note: "Admin pause" });
      toast.success(`Access extended by ${days} days`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to pause");
    }
  }

  async function raiseCapacity(row: Row) {
    try {
      await addSeat.mutateAsync({ id: row.instructor.id });
      toast.success(`Added one sellable seat for ${row.instructor.name}`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update capacity");
    }
  }

  async function close(row: Row) {
    const reason = window.prompt(
      `Close this pack with ${row.remainingSessions} sessions unused?\n\nThis forfeits the sessions. Only do this after the student confirms they are finished. Enter a reason:`
    );
    if (!reason) return;
    try {
      await closePack.mutateAsync({ packId: row.packId, reason });
      toast.success("Pack closed");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to close pack");
    }
  }

  const rows = data?.rows ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Students with sessions left</h1>
        <p className="text-muted-foreground mt-1 max-w-3xl">
          Sessions are never removed automatically. These students have sessions remaining but
          either passed their access date or have not booked in {data?.dormantDays ?? 45} days.
          Contact them to find out their plan, extend access if they are taking a break, or add a
          sellable seat so a held seat does not block new students.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : error ? (
        <Card>
          <CardContent className="pt-6 text-sm text-destructive">
            Could not load the queue. {error instanceof Error ? error.message : null}
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Nothing needs attention</CardTitle>
            <CardDescription>
              Every student with sessions remaining has booked recently or is inside their access
              window.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Student</th>
                <th className="px-4 py-3 font-medium">Instructor</th>
                <th className="px-4 py-3 font-medium">Sessions</th>
                <th className="px-4 py-3 font-medium">Last activity</th>
                <th className="px-4 py-3 font-medium">Access</th>
                <th className="px-4 py-3 font-medium">Seat</th>
                <th className="px-4 py-3 font-medium">Instructor capacity</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.packId} className="border-t align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium">{row.student.name}</div>
                    {row.student.email ? (
                      <div className="text-xs text-muted-foreground">{row.student.email}</div>
                    ) : null}
                    <div className="mt-1 flex gap-1">
                      {row.reasons.map((reason) => (
                        <Badge
                          key={reason}
                          variant={reason === "expired" ? "destructive" : "secondary"}
                        >
                          {reason === "expired" ? "Past access date" : "No recent sessions"}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">{row.instructor.name}</td>
                  <td className="px-4 py-3">
                    {row.remainingSessions} of {row.totalSessions}
                  </td>
                  <td className="px-4 py-3">
                    {formatDate(row.lastActivity)}
                    <div className="text-xs text-muted-foreground">{row.dormantDays}d ago</div>
                  </td>
                  <td className="px-4 py-3">
                    {row.expiresAt ? formatDate(row.expiresAt) : "No date"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={row.seatStatus === "active" ? "secondary" : "outline"}>
                      {row.seatStatus ?? "none"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div>
                      {row.capacity.activeSeats} active / {row.capacity.inventory} sellable
                    </div>
                    {row.capacity.maxActiveStudents !== null ? (
                      <div className="text-xs text-muted-foreground">
                        cap {row.capacity.maxActiveStudents}
                      </div>
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      disabled={addSeat.isPending}
                      onClick={() => raiseCapacity(row)}
                    >
                      <PlusCircle className="h-3.5 w-3.5 mr-1" /> {`Add a seat`}
                    </Button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-2 items-end">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => contactStudent(row)}
                        disabled={!row.student.email}
                      >
                        <Mail className="h-3.5 w-3.5 mr-1" /> Email
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => pause(row)}
                        disabled={pausePack.isPending}
                      >
                        <Pause className="h-3.5 w-3.5 mr-1" /> Pause
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => close(row)}
                        disabled={closePack.isPending}
                      >
                        <XCircle className="h-3.5 w-3.5 mr-1" /> Close
                      </Button>
                      {row.lastContactedAt ? (
                        <div className="text-xs text-muted-foreground">
                          Contacted {formatDate(row.lastContactedAt)}
                        </div>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
