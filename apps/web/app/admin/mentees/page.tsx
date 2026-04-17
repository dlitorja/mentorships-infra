"use client";

import React, { useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Plus, Search, UserPlus, Settings2 } from "lucide-react";
import { apiFetch } from "@/lib/queries/api-client";

type Mentee = {
  id: string;
  userId: string;
  email: string;
  mentorId: string;
  instructorName: string;
  instructorSlug: string;
  instructorId: string;
  totalSessions: number;
  remainingSessions: number;
  status: "active" | "depleted" | "expired" | "refunded";
  expiresAt: string | null;
  purchasedAt: string;
};

type SessionCount = {
  id: string;
  userId: string;
  instructorId: string;
  instructorName: string | null;
  sessionCount: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

type SessionCountsResponse = {
  items: SessionCount[];
};

type MenteesResponse = {
  items: Mentee[];
  total: number;
  page: number;
  pageSize: number;
};

async function fetchMentees(search?: string, instructorId?: string): Promise<MenteesResponse> {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (instructorId) params.set("instructorId", instructorId);
  
  const url = `/api/admin/mentees${params.toString() ? `?${params.toString()}` : ""}`;
  return apiFetch<MenteesResponse>(url);
}

async function fetchInstructors() {
  return apiFetch<{ items: { id: string; name: string; slug: string }[] }>("/api/admin/instructors?includeInactive=true");
}

async function fetchSessionCounts(userId: string): Promise<SessionCountsResponse> {
  return apiFetch<SessionCountsResponse>(`/api/admin/mentees/${userId}/session-count`);
}

async function createOrUpdateSessionCount(userId: string, data: { instructorId: string; sessionCount: number; notes?: string }) {
  const response = await fetch(`/api/admin/mentees/${userId}/session-count`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to create session count");
  }
  return response.json();
}

async function adjustSessionCount(userId: string, data: { id: string; adjustment: number; notes?: string }) {
  const response = await fetch(`/api/admin/mentees/${userId}/session-count`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to adjust session count");
  }
  return response.json();
}

export default function MenteesPage() {
  const [search, setSearch] = useState("");
  const [instructorFilter, setInstructorFilter] = useState("");

  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["mentees", search, instructorFilter],
    queryFn: () => fetchMentees(search, instructorFilter || undefined),
  });

  const { data: instructorsData } = useQuery({
    queryKey: ["instructors"],
    queryFn: fetchInstructors,
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
        return "default";
      case "depleted":
        return "destructive";
      case "expired":
        return "secondary";
      case "refunded":
        return "outline";
      default:
        return "secondary";
    }
  };

  return (
    <div className="container mx-auto py-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Mentees</h1>
          <p className="text-muted-foreground mt-1">
            Manage mentees and their mentorship sessions
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/mentees/invite">
            <Button variant="outline">
              <UserPlus className="mr-2 h-4 w-4" />
              Invite Mentee
            </Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row gap-4 justify-between">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by email or name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <select
              value={instructorFilter}
              onChange={(e) => setInstructorFilter(e.target.value)}
              className="px-3 py-2 border rounded-md text-sm"
            >
              <option value="">All Instructors</option>
              {instructorsData?.items.map((inst) => (
                <option key={inst.id} value={inst.id}>
                  {inst.name}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : data?.items.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No mentees found.{" "}
              <Link href="/admin/mentees/invite" className="text-primary hover:underline">
                Invite a mentee
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-medium">Mentee</th>
                    <th className="text-left py-3 px-4 font-medium">Instructor</th>
                    <th className="text-left py-3 px-4 font-medium">Sessions</th>
                    <th className="text-left py-3 px-4 font-medium">Status</th>
                    <th className="text-left py-3 px-4 font-medium">Expires</th>
                    <th className="text-left py-3 px-4 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.items.map((mentee) => (
                    <tr key={mentee.id} className="border-b hover:bg-muted/50">
                      <td className="py-3 px-4">
                        <div>
                          <div className="font-medium">{mentee.email}</div>
                          <div className="text-sm text-muted-foreground truncate max-w-[200px]">
                            {mentee.userId}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {mentee.instructorSlug ? (
                          <Link
                            href={`/instructors/${mentee.instructorSlug}`}
                            target="_blank"
                            className="text-primary hover:underline"
                          >
                            {mentee.instructorName}
                          </Link>
                        ) : (
                          <span>{mentee.instructorName}</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={
                            mentee.remainingSessions === 0
                              ? "text-destructive font-medium"
                              : mentee.remainingSessions <= 2
                              ? "text-yellow-600 font-medium"
                              : ""
                          }
                        >
                          {mentee.remainingSessions} / {mentee.totalSessions}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                          <Badge variant={getStatusColor(mentee.status)}>
                          {mentee.status}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-sm text-muted-foreground">
                        {mentee.expiresAt
                          ? new Date(mentee.expiresAt).toLocaleDateString()
                          : "—"}
                      </td>
                      <td className="py-3 px-4">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={async () => {
                            const input = prompt(
                              `Set manual sessions for ${mentee.email} (${mentee.instructorName}):`
                            );
                            if (input === null) return;

                            const trimmed = input.trim();
                            const sessionCount = Number(trimmed);
                            if (
                              trimmed === "" ||
                              !Number.isInteger(sessionCount) ||
                              sessionCount < 0
                            ) {
                              alert("Enter a non-negative whole number of sessions");
                              return;
                            }

                            try {
                              await createOrUpdateSessionCount(mentee.userId, {
                                instructorId: mentee.instructorId,
                                sessionCount,
                              });
                              await queryClient.invalidateQueries({ queryKey: ["mentees"] });
                              alert("Sessions updated!");
                            } catch {
                              alert("Failed to update sessions");
                            }
                          }}
                        >
                          Set Sessions
                        </Button>
                      </td>
                    </tr>
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
