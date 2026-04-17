"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Minus, Plus, Calendar } from "lucide-react";
import { apiFetch } from "@/lib/queries/api-client";

type Mentee = {
  userId: string;
  email: string;
  sessionPackId: string;
  totalSessions: number;
  remainingSessions: number;
  status: "active" | "depleted" | "expired" | "refunded";
  expiresAt: string | null;
  lastSessionCompletedAt: string | null;
  completedSessionCount: number;
};

async function fetchMentees(): Promise<{ items: Mentee[] }> {
  return apiFetch<{ items: Mentee[] }>("/api/instructor/mentees");
}

async function updateSessionCount(
  sessionPackId: string,
  action: "increment" | "decrement" | "set",
  amount: number = 1
) {
  const response = await fetch(`/api/instructor/mentees/${sessionPackId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, amount }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to update session count");
  }

  return response.json();
}

export default function InstructorMenteesPage() {
  const queryClient = useQueryClient();
  const [editingPackId, setEditingPackId] = useState<string | null>(null);
  const [customAmount, setCustomAmount] = useState<string>("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["instructor-mentees"],
    queryFn: fetchMentees,
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
      queryClient.invalidateQueries({ queryKey: ["instructor-mentees"] });
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

  const getStatusColor = (status: string, remaining: number) => {
    if (status === "expired" || status === "refunded") return "secondary";
    if (remaining === 0) return "destructive";
    if (remaining <= 2) return "outline";
    return "default";
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "No sessions yet";
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto py-8">
        <Card>
          <CardContent className="pt-6">
            <p className="text-destructive text-center">
              Failed to load mentees: {error instanceof Error ? error.message : "Unknown error"}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const mentees = data?.items || [];

  return (
    <div className="container mx-auto py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">My Mentees</h1>
        <p className="text-muted-foreground mt-1">
          Manage your mentees and track session counts
        </p>
      </div>

      {mentees.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">
              You don&apos;t have any mentees yet. Mentees will appear here after they purchase a session pack.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {mentees.map((mentee) => (
            <Card key={mentee.sessionPackId}>
              <CardContent className="pt-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex-1">
                    <div className="font-medium text-lg">{mentee.email}</div>
                    <div className="flex items-center gap-3 mt-2">
                      <Badge variant={getStatusColor(mentee.status, mentee.remainingSessions)}>
                        {mentee.status}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {mentee.completedSessionCount} of {mentee.totalSessions} sessions used
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">Last session:</span>
                      <div className="flex items-center gap-1 text-sm">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        {formatDate(mentee.lastSessionCompletedAt)}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground mr-2">Sessions:</span>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => handleDecrement(mentee.sessionPackId)}
                      disabled={
                        updateMutation.isPending ||
                        mentee.remainingSessions === 0
                      }
                    >
                      <Minus className="h-4 w-4" />
                    </Button>

                    {editingPackId === mentee.sessionPackId ? (
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          min="0"
                          value={customAmount}
                          onChange={(e) => setCustomAmount(e.target.value)}
                          className="w-20 h-9 text-center"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleCustomSet(mentee.sessionPackId);
                            if (e.key === "Escape") {
                              setEditingPackId(null);
                              setCustomAmount("");
                            }
                          }}
                        />
                        <Button
                          size="sm"
                          onClick={() => handleCustomSet(mentee.sessionPackId)}
                          disabled={updateMutation.isPending}
                        >
                          Set
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        className="min-w-[60px] font-mono"
                        onClick={() => {
                          setEditingPackId(mentee.sessionPackId);
                          setCustomAmount(String(mentee.remainingSessions));
                        }}
                      >
                        {mentee.remainingSessions}
                      </Button>
                    )}

                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => handleIncrement(mentee.sessionPackId)}
                      disabled={updateMutation.isPending}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {mentee.expiresAt && (
                  <div className="mt-3 text-sm text-muted-foreground">
                    Expires: {new Date(mentee.expiresAt).toLocaleDateString()}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
