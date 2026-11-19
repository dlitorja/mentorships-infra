"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, ArrowLeft, ExternalLink, Mail, User } from "lucide-react";
import {
  useInstructorOptions,
  useKajabiPurchase,
} from "@/lib/queries/convex/use-kajabi-purchases";
import type { Id } from "@/convex/_generated/dataModel";

function formatDateTime(ms: number | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

function defaultExpiry(): string {
  return new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

export default function AdminKajabiPurchaseDetailPage(): React.JSX.Element {
  const params = useParams<{ id: string }>();
  const id = (params?.id ?? null) as Id<"kajabiPurchaseInbox"> | null;
  const router = useRouter();

  const purchaseQuery = useKajabiPurchase(id);
  const instructorQuery = useInstructorOptions();
  const purchase = purchaseQuery.data;

  const [instructorId, setInstructorId] = useState<string>("");
  const [sessions, setSessions] = useState<number>(4);
  const [expiry, setExpiry] = useState<string>(defaultExpiry);
  const [notes, setNotes] = useState<string>("");
  const [dismissReason, setDismissReason] = useState<string>("");
  const [submitting, setSubmitting] = useState<"approve" | "dismiss" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const instructors = instructorQuery.data ?? [];

  useEffect(() => {
    if (!purchase || instructorId || instructors.length === 0) return;
    const name = purchase.instructorName?.trim().toLowerCase();
    const match = name
      ? instructors.find((i) => (i.name ?? "").trim().toLowerCase() === name)
      : undefined;
    setInstructorId((match ?? instructors[0]).id);
  }, [instructorId, instructors, purchase]);

  const canApprove = useMemo(() => {
    return (
      purchase?.status === "pending" &&
      !!purchase.studentEmail &&
      !!instructorId &&
      sessions >= 1 &&
      !!expiry
    );
  }, [purchase, instructorId, sessions, expiry]);

  async function handleApprove(): Promise<void> {
    if (!id) return;
    setSubmitting("approve");
    setError(null);
    try {
      const expiresAt = new Date(`${expiry}T23:59:59Z`).getTime();
      const res = await fetch(`/api/admin/kajabi-purchases/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instructorId,
          sessionsPerInstructor: sessions,
          expiresAt,
          notes: notes.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (json.onboardingId && (res.ok || res.status === 409 || res.status === 502)) {
        if (res.ok) {
          router.push(`/admin/onboardings/${json.onboardingId}`);
          return;
        }
        setError(
          `${json.error ?? "Approval partially completed"} — open onboarding ${json.onboardingId}`
        );
        return;
      }
      setError(json.error ?? "Failed to approve purchase");
    } finally {
      setSubmitting(null);
    }
  }

  async function handleDismiss(): Promise<void> {
    if (!id) return;
    setSubmitting("dismiss");
    setError(null);
    try {
      const res = await fetch(`/api/admin/kajabi-purchases/${id}/dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: dismissReason.trim() || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Failed to dismiss purchase");
        return;
      }
      router.push("/admin/kajabi-purchases");
    } finally {
      setSubmitting(null);
    }
  }

  if (purchaseQuery.isLoading) {
    return (
      <div className="container mx-auto flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (purchaseQuery.error || !purchase) {
    return (
      <div className="container mx-auto space-y-4 p-8">
        <Link href="/admin/kajabi-purchases" className="text-sm underline">
          ← Back to Kajabi purchases
        </Link>
        <p className="text-sm text-destructive">
          {purchaseQuery.error?.message ?? "Purchase not found"}
        </p>
      </div>
    );
  }

  return (
    <div className="container mx-auto space-y-6 p-4 md:p-8">
      <div className="flex items-center justify-between gap-4">
        <Link
          href="/admin/kajabi-purchases"
          className="inline-flex items-center gap-1 text-sm underline"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Kajabi purchases
        </Link>
        <Badge variant={purchase.status === "pending" ? "default" : "secondary"}>
          {purchase.status}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{purchase.offerTitle}</CardTitle>
          <CardDescription>
            Received {formatDateTime(purchase.receivedAt)} from{" "}
            {purchase.fromAddress}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-start gap-2">
              <User className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div>
                <div className="text-xs text-muted-foreground">Student</div>
                <div className="font-medium">
                  {purchase.studentName ?? "Unknown"}
                </div>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Mail className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div>
                <div className="text-xs text-muted-foreground">Email</div>
                <div className="font-medium">
                  {purchase.studentEmail ?? "Not found in the confirmation"}
                </div>
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Purchase type</div>
              <div className="font-medium">
                {purchase.purchaseType === "one-on-one"
                  ? "1-on-1 mentorship"
                  : purchase.purchaseType === "group"
                    ? "Group mentorship"
                    : "Unknown"}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Instructor</div>
              <div className="font-medium">
                {purchase.instructorName ?? "Not found"}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Kajabi purchase ID</div>
              <div className="font-mono text-sm">
                {purchase.kajabiPurchaseId ?? "—"}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Kajabi contact</div>
              {purchase.kajabiContactId ? (
                <a
                  href={`https://app.kajabi.com/admin/contacts/${purchase.kajabiContactId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm underline"
                >
                  Open contact <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <div className="text-sm">—</div>
              )}
            </div>
          </div>

          <details className="rounded-md border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              Raw confirmation
            </summary>
            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
              {purchase.rawText}
            </pre>
          </details>
        </CardContent>
      </Card>

      {purchase.status === "pending" ? (
        <Card>
          <CardHeader>
            <CardTitle>Approve and onboard</CardTitle>
            <CardDescription>
              Creates the workspace and sends the student, instructor, and
              admin emails. Nothing is sent before you confirm.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="space-y-1 text-sm">
                <span className="font-medium">Instructor</span>
                <select
                  className="w-full rounded-md border bg-background p-2"
                  value={instructorId}
                  onChange={(e) => setInstructorId(e.target.value)}
                >
                  {instructors.map((instructor) => (
                    <option key={instructor.id} value={instructor.id}>
                      {instructor.name ?? instructor.email ?? instructor.id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">Sessions</span>
                <Input
                  type="number"
                  min={1}
                  value={sessions}
                  onChange={(e) => setSessions(Number(e.target.value))}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">Access through</span>
                <Input
                  type="date"
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value)}
                />
              </label>
            </div>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Notes (optional)</span>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything the onboarding record should note"
              />
            </label>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={handleApprove}
                disabled={!canApprove || submitting !== null}
              >
                {submitting === "approve" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Approve and onboard
              </Button>
              <Button
                variant="outline"
                onClick={handleDismiss}
                disabled={submitting !== null}
              >
                {submitting === "dismiss" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Dismiss
              </Button>
              <Input
                className="max-w-xs"
                value={dismissReason}
                onChange={(e) => setDismissReason(e.target.value)}
                placeholder="Dismiss reason (optional)"
              />
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
            <CardDescription>
              {purchase.status === "approved"
                ? "This purchase was approved and an onboarding record was created."
                : "This purchase was dismissed."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {purchase.status === "approved" && purchase.onboardingId ? (
              <Link
                href={`/admin/onboardings/${purchase.onboardingId}`}
                className="underline"
              >
                Open onboarding record
              </Link>
            ) : null}
            {purchase.status === "dismissed" ? (
              <p>
                Dismissed {formatDateTime(purchase.dismissedAt)}
                {purchase.dismissReason ? ` — ${purchase.dismissReason}` : ""}
              </p>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
