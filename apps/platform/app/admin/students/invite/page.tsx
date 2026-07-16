"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Mail, ArrowLeft, Sparkles } from "lucide-react";
import { apiFetch } from "@/lib/queries/api-client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import AdminOnboardingForm from "@/components/admin/admin-onboarding-form";

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
  const url = `/api/admin/students/invite${params.toString() ? `?${params.toString()}` : ""}`;
  return apiFetch<InvitationsResponse>(url);
}

async function fetchInstructors() {
  return apiFetch<{ instructors: { id: string; name: string; slug: string }[] }>("/api/admin/instructors");
}

async function createInvitation(data: { email: string; instructorId: string }) {
  const response = await fetch("/api/admin/students/invite", {
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

type Mode = "invitation_only" | "full_onboarding";

export default function InviteStudentPage() {
  const [mode, setMode] = useState<Mode>("invitation_only");

  return (
    <div className="container mx-auto py-8">
      <Link href="/admin/students" className="flex items-center text-sm text-muted-foreground hover:text-foreground mb-6">
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Students
      </Link>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-4">
          <ModeToggle value={mode} onChange={setMode} />
          {mode === "invitation_only" ? (
            <InvitationOnlyCard />
          ) : (
            <FullOnboardingCard />
          )}
        </div>

        <PendingInvitationsCard />
      </div>
    </div>
  );
}

function ModeToggle({ value, onChange }: { value: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="inline-flex w-full rounded-md border bg-muted p-1">
      <button
        type="button"
        onClick={() => onChange("invitation_only")}
        className={`flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
          value === "invitation_only"
            ? "bg-background text-foreground shadow"
            : "text-muted-foreground hover:text-foreground"
        }`}
        aria-pressed={value === "invitation_only"}
      >
        Invitation only
      </button>
      <button
        type="button"
        onClick={() => onChange("full_onboarding")}
        className={`flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors flex items-center justify-center gap-1.5 ${
          value === "full_onboarding"
            ? "bg-background text-foreground shadow"
            : "text-muted-foreground hover:text-foreground"
        }`}
        aria-pressed={value === "full_onboarding"}
      >
        <Sparkles className="h-3.5 w-3.5" />
        Full onboarding
      </button>
    </div>
  );
}

function InvitationOnlyCard() {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [instructorId, setInstructorId] = useState("");
  const [error, setError] = useState("");

  const { data: instructorsData, isLoading: isLoadingInstructors } = useQuery({
    queryKey: ["instructors"],
    queryFn: fetchInstructors,
  });

  const createMutation = useMutation({
    mutationFn: createInvitation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["student-invitations"] });
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite Student</CardTitle>
        <CardDescription>
          Send an invitation to a prospective student. They will receive an email to sign up and will be linked to the selected instructor.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email Address</Label>
            <Input
              id="email"
              type="email"
              placeholder="student@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={createMutation.isPending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="instructor">Instructor</Label>
            <Select
              value={instructorId || "__none__"}
              onValueChange={(v) => setInstructorId(v === "__none__" ? "" : v)}
              disabled={createMutation.isPending || isLoadingInstructors}
            >
              <SelectTrigger id="instructor" className="w-full">
                <SelectValue placeholder="Select an instructor..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Select an instructor...</SelectItem>
                {(instructorsData?.instructors ?? []).map((inst) => (
                  <SelectItem key={inst.id} value={inst.id}>
                    {inst.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{error}</div>
          )}

          <Button type="submit" disabled={createMutation.isPending || !email || !instructorId} className="w-full">
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
  );
}

function FullOnboardingCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Full Onboarding</CardTitle>
        <CardDescription>
          Create a student account, assign one or more instructors, and prepare
          instructor workspaces — all in one submission. The two-phase form
          previews side effects before you commit.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AdminOnboardingForm />
      </CardContent>
    </Card>
  );
}

const FILTER_TO_TITLE: Record<string, string> = {
  pending: "Pending Invitations",
  accepted: "Accepted Invitations",
  expired: "Expired Invitations",
  all: "All Invitations",
};

function PendingInvitationsCard() {
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const { data: invitations, isLoading: isLoadingInvitations } = useQuery({
    queryKey: ["student-invitations", statusFilter],
    queryFn: () => fetchInvitations(statusFilter),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{FILTER_TO_TITLE[statusFilter] ?? "Invitations"}</CardTitle>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Filter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="accepted">Accepted</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {isLoadingInvitations ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : invitations?.items.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No invitations found</div>
        ) : (
          <div className="space-y-3">
            {invitations?.items.map((invitation) => (
              <div key={invitation.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{invitation.email}</div>
                  <div className="text-sm text-muted-foreground">{invitation.instructorName}</div>
                  <div className="text-xs text-muted-foreground">Expires: {new Date(invitation.expiresAt).toLocaleDateString()}</div>
                </div>
                <div className="ml-4">{(function(){return (
                  invitation.status === "pending" ? <Badge variant="default">Pending</Badge> :
                  invitation.status === "accepted" ? <Badge variant="secondary">Accepted</Badge> :
                  invitation.status === "expired" ? <Badge variant="destructive">Expired</Badge> :
                  invitation.status === "cancelled" ? <Badge variant="outline">Cancelled</Badge> :
                  <Badge>{invitation.status}</Badge>
                )})()}</div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
