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
import { Loader2, Mail, ArrowLeft } from "lucide-react";
import { apiFetch } from "@/lib/queries/api-client";

type Invitation = {
  id: string;
  email: string;
  instructorId: string;
  instructorName: string;
  instructorSlug: string;
  clerkInvitationId: string | null;
  expiresAt: string;
  status: "pending" | "accepted" | "expired" | "cancelled";
  createdAt: string;
};

type InvitationsResponse = {
  items: Invitation[];
  total: number;
  page: number;
  pageSize: number;
};

async function fetchInvitations(status?: string): Promise<InvitationsResponse> {
  const params = new URLSearchParams();
  if (status && status !== "all") params.set("status", status);
  
  const url = `/api/admin/mentees/invite${params.toString() ? `?${params.toString()}` : ""}`;
  return apiFetch<InvitationsResponse>(url);
}

async function fetchInstructors() {
  return apiFetch<{ items: { id: string; name: string; slug: string }[] }>("/api/admin/instructors?includeInactive=true");
}

async function createInvitation(data: { email: string; instructorId: string }) {
  const response = await fetch("/api/admin/mentees/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to create invitation");
  }
  
  return response.json();
}

export default function InviteMenteePage() {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [instructorId, setInstructorId] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [error, setError] = useState("");

  const { data: invitations, isLoading: isLoadingInvitations } = useQuery({
    queryKey: ["mentee-invitations", statusFilter],
    queryFn: () => fetchInvitations(statusFilter),
  });

  const { data: instructorsData, isLoading: isLoadingInstructors } = useQuery({
    queryKey: ["instructors"],
    queryFn: fetchInstructors,
  });

  const createMutation = useMutation({
    mutationFn: createInvitation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mentee-invitations"] });
      setEmail("");
      setInstructorId("");
      setError("");
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Failed to create invitation");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !instructorId) {
      setError("Please fill in all fields");
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      setError("Please enter a valid email address");
      return;
    }
    setError("");
    createMutation.mutate({ email: trimmedEmail, instructorId });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="default">Pending</Badge>;
      case "accepted":
        return <Badge variant="secondary">Accepted</Badge>;
      case "expired":
        return <Badge variant="destructive">Expired</Badge>;
      case "cancelled":
        return <Badge variant="outline">Cancelled</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  return (
    <div className="container mx-auto py-8">
      <Link
        href="/admin/mentees"
        className="flex items-center text-sm text-muted-foreground hover:text-foreground mb-6"
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Mentees
      </Link>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Invite Mentee</CardTitle>
            <CardDescription>
              Send an invitation to a potential mentee. They will receive an email to
              sign up and will be linked to the selected instructor.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="mentee@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={createMutation.isPending}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="instructor">Instructor</Label>
                <select
                  id="instructor"
                  value={instructorId}
                  onChange={(e) => setInstructorId(e.target.value)}
                  disabled={createMutation.isPending || isLoadingInstructors}
                  className="w-full px-3 py-2 border rounded-md text-sm"
                >
                  <option value="">Select an instructor...</option>
                  {instructorsData?.items.map((inst) => (
                    <option key={inst.id} value={inst.id}>
                      {inst.name}
                    </option>
                  ))}
                </select>
              </div>

              {error && (
                <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                disabled={createMutation.isPending || !email || !instructorId}
                className="w-full"
              >
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Mail className="mr-2 h-4 w-4" />
                    Send Invitation
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Pending Invitations</CardTitle>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-2 py-1 border rounded-md text-sm"
              >
                <option value="pending">Pending</option>
                <option value="accepted">Accepted</option>
                <option value="expired">Expired</option>
                <option value="all">All</option>
              </select>
            </div>
          </CardHeader>
          <CardContent>
            {isLoadingInvitations ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : invitations?.items.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No invitations found
              </div>
            ) : (
              <div className="space-y-3">
                {invitations?.items.map((invitation) => (
                  <div
                    key={invitation.id}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{invitation.email}</div>
                      <div className="text-sm text-muted-foreground">
                        {invitation.instructorName}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Expires: {new Date(invitation.expiresAt).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="ml-4">{getStatusBadge(invitation.status)}</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
