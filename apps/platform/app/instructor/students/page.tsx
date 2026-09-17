"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Minus, Plus, Calendar, ChevronRight, Search, ArrowUpDown, AlertTriangle } from "lucide-react";
import { ApiRoutes } from "@/lib/routes";
import { ApiFetchError, apiFetch, updateSessionPack } from "@/lib/queries/api-client";

type Student = {
  userId: string;
  email: string;
  sessionPackId: string;
  totalSessions: number;
  remainingSessions: number;
  status: "active" | "depleted" | "expired" | "refunded";
  expiresAt: string | null;
  lastSessionCompletedAt: string | null;
  completedSessionCount: number;
  workspaceId: string | null;
};

/**
 * Fetches the signed-in instructor's student list.
 */
async function fetchStudents(): Promise<{ items: Student[] }> {
  return apiFetch<{ items: Student[] }>(ApiRoutes.instructorStudents);
}

/**
 * Updates a session pack's remaining session count via the API.
 */
async function updateSessionCount(
  sessionPackId: string,
  action: "increment" | "decrement" | "set",
  amount: number = 1
) {
  const { ok, json } = await updateSessionPack(sessionPackId, { action, amount });
  if (!ok) {
    throw new Error(json.error || "Failed to update session count");
  }
  return json;
}

/**
 * Structured response shape that the
 * `GET /api/instructor/students` route returns when the signed-in
 * Clerk userId no longer matches the instructor record. See
 * `apps/platform/app/api/instructor/students/route.ts` for the
 * server side; this type mirrors the JSON payload so the UI can
 * render the reconciliation guidance instead of a bare 404.
 */
type InstructorLinkingReconciliationError = {
  error: string;
  code: "instructor_linking_needs_reconciliation";
  instructorId: string;
  email: string;
  existingClerkUserId: string;
};

function isInstructorLinkingReconciliationError(
  data: unknown,
): data is InstructorLinkingReconciliationError {
  if (typeof data !== "object" || data === null) return false;
  const candidate = data as Record<string, unknown>;
  return (
    candidate.code === "instructor_linking_needs_reconciliation" &&
    typeof candidate.existingClerkUserId === "string" &&
    typeof candidate.email === "string" &&
    typeof candidate.instructorId === "string"
  );
}

/**
 * Page that lets instructors view their students, search, sort, and adjust session counts.
 */
export default function InstructorStudentsPage() {
  const queryClient = useQueryClient();
  const [editingPackId, setEditingPackId] = useState<string | null>(null);
  const [customAmount, setCustomAmount] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"email" | "status" | "remaining" | "lastSession">("email");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  const { data, isLoading, error } = useQuery({
    queryKey: ["instructor-students"],
    queryFn: fetchStudents,
  });

  const updateMutation = useMutation({
    mutationFn: ({
      sessionPackId,
      action,
      amount,
    }: {
      sessionPackId: string;
      action: "increment" | "decrement" | "set";
      amount?: number;
    }) => updateSessionCount(sessionPackId, action, amount),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["instructor-students"] });
      setEditingPackId(null);
      setCustomAmount("");
    },
  });

  const handleIncrement = (sessionPackId: string) => {
    updateMutation.mutate({ sessionPackId, action: "increment" });
  };

  const handleDecrement = (sessionPackId: string) => {
    updateMutation.mutate({ sessionPackId, action: "decrement" });
  };

  const handleCustomSet = (sessionPackId: string) => {
    const amount = parseInt(customAmount, 10);
    if (isNaN(amount) || amount < 0) return;
    
    updateMutation.mutate(
      { sessionPackId, action: "set", amount },
      {
        onSuccess: () => {
          setEditingPackId(null);
          setCustomAmount("");
        },
      }
    );
  };

  /**
   * Maps a session pack status to a Badge variant.
   */
  const getStatusColor = (status: string, remaining: number) => {
    if (status === "expired" || status === "refunded") return "secondary";
    if (remaining === 0) return "destructive";
    if (remaining <= 2) return "outline";
    return "default";
  };

  /**
   * Formats an ISO date string into a human-readable date.
   */
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return null;
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const students = useMemo(() => data?.items || [], [data?.items]);

  const filteredAndSortedStudents = useMemo(() => {
    let result = [...students];

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter((s) => s.email.toLowerCase().includes(query));
    }

    result.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case "email":
          comparison = a.email.localeCompare(b.email);
          break;
        case "status":
          comparison = a.status.localeCompare(b.status);
          break;
        case "remaining":
          comparison = a.remainingSessions - b.remainingSessions;
          break;
        case "lastSession": {
          const aSession = a.lastSessionCompletedAt;
          const bSession = b.lastSessionCompletedAt;
          if (aSession === null && bSession === null) {
            comparison = 0;
          } else if (aSession === null) {
            comparison = 1;
          } else if (bSession === null) {
            comparison = -1;
          } else {
            const aTime = new Date(aSession).getTime();
            const bTime = new Date(bSession).getTime();
            comparison = aTime - bTime;
          }
          break;
        }
      }
      return sortOrder === "asc" ? comparison : -comparison;
    });

    return result;
  }, [students, searchQuery, sortBy, sortOrder]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (error) {
    // Greptile P1 (round 2, "Diagnostic Data Is Discarded"): the
    // server returns a structured 409 with
    // `code: "instructor_linking_needs_reconciliation"` plus the
    // existing Clerk userId when the signed-in account no longer
    // matches the instructor record. Render the actionable guidance
    // instead of the generic `Failed to load students: <message>` so
    // the instructor sees which account they need to sign in with
    // (or which admin to contact) instead of a dead-end error.
    if (
      error instanceof ApiFetchError &&
      error.status === 409 &&
      isInstructorLinkingReconciliationError(error.data)
    ) {
      const reconciliation = error.data;
      return (
        <div className="container mx-auto py-8">
          <Card className="border-amber-500/50">
            <CardContent className="pt-6 space-y-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 flex-shrink-0" />
                <div className="space-y-1">
                  <h2 className="font-semibold text-lg">
                    Sign-in account doesn&apos;t match your instructor record
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {reconciliation.error}
                  </p>
                </div>
              </div>
              <div className="rounded-md bg-muted/50 p-4 space-y-2 text-sm">
                <div className="grid grid-cols-3 gap-2">
                  <span className="font-medium text-muted-foreground">Email</span>
                  <span className="col-span-2 font-mono">{reconciliation.email}</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <span className="font-medium text-muted-foreground">Existing Clerk user</span>
                  <span className="col-span-2 font-mono text-xs break-all">
                    {reconciliation.existingClerkUserId}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <span className="font-medium text-muted-foreground">Instructor record</span>
                  <span className="col-span-2 font-mono text-xs break-all">
                    {reconciliation.instructorId}
                  </span>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Sign out and sign back in with the email{" "}
                <span className="font-mono font-medium">{reconciliation.email}</span>{" "}
                using the original account, or contact support to relink the
                accounts to your current sign-in.
              </p>
            </CardContent>
          </Card>
        </div>
      );
    }

    return (
      <div className="container mx-auto py-8">
        <Card>
          <CardContent className="pt-6">
            <p className="text-destructive text-center">
              Failed to load students: {error instanceof Error ? error.message : "Unknown error"}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">My Students</h1>
        <p className="text-muted-foreground mt-1">
          Manage your students and track session counts
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={sortBy} onValueChange={(v) => { setSortBy(v as typeof sortBy); setSortOrder("asc"); }}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="email">Sort by Email</SelectItem>
            <SelectItem value="status">Sort by Status</SelectItem>
            <SelectItem value="remaining">Sort by Remaining</SelectItem>
            <SelectItem value="lastSession">Sort by Last Session</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
          title={sortOrder === "asc" ? "Ascending" : "Descending"}
        >
          <ArrowUpDown className="h-4 w-4" />
        </Button>
      </div>

      {filteredAndSortedStudents.length === 0 && students.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">
              No students match your search.
            </p>
          </CardContent>
        </Card>
      )}

      {filteredAndSortedStudents.length === 0 && students.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">
              You don&apos;t have any students yet. Students will appear here after they purchase a session pack.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {filteredAndSortedStudents.map((student) => (
            <Link
              key={student.sessionPackId}
              href={student.workspaceId ? `/workspace/${student.workspaceId}` : `/instructor/students/${student.userId}`}
              className="block"
            >
              <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                <CardContent className="pt-6">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <div className="font-medium text-lg">{student.email}</div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex items-center gap-3 mt-2">
                        <Badge variant={getStatusColor(student.status, student.remainingSessions)}>
                          {student.status}
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          {student.completedSessionCount} of {student.totalSessions} sessions used
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">Last session:</span>
                        {formatDate(student.lastSessionCompletedAt) ? (
                          <div className="flex items-center gap-1 text-sm">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            {formatDate(student.lastSessionCompletedAt)}
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">No completed sessions yet</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2" onClick={(e) => e.preventDefault()}>
                      <span className="text-sm text-muted-foreground mr-2">Sessions:</span>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleDecrement(student.sessionPackId);
                        }}
                        disabled={
                          updateMutation.isPending ||
                          student.remainingSessions === 0
                        }
                      >
                        <Minus className="h-4 w-4" />
                      </Button>

                      {editingPackId === student.sessionPackId ? (
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            min="0"
                            value={customAmount}
                            onChange={(e) => setCustomAmount(e.target.value)}
                            className="w-20 h-9 text-center"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleCustomSet(student.sessionPackId);
                              if (e.key === "Escape") {
                                setEditingPackId(null);
                                setCustomAmount("");
                              }
                            }}
                          />
                          <Button
                            size="sm"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleCustomSet(student.sessionPackId);
                            }}
                            disabled={updateMutation.isPending}
                          >
                            Set
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          className="min-w-[60px] font-mono"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setEditingPackId(student.sessionPackId);
                            setCustomAmount(String(student.remainingSessions));
                          }}
                        >
                          {student.remainingSessions}
                        </Button>
                      )}

                      <Button
                        variant="outline"
                        size="icon"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleIncrement(student.sessionPackId);
                        }}
                        disabled={updateMutation.isPending}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {student.expiresAt && (
                    <div className="mt-3 text-sm text-muted-foreground">
                      Expires: {new Date(student.expiresAt).toLocaleDateString()}
                    </div>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
