"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Mail, Loader2, RefreshCw } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useOnboardingReminders,
  useOnboardingReminderCounts,
  type OnboardingReminderKind,
  type OnboardingReminderStatus,
} from "@/lib/queries/convex/use-onboarding-reminders";

const STATUS_TABS: Array<{ value: OnboardingReminderStatus; label: string }> = [
  { value: "pending_review", label: "Pending review" },
  { value: "approved", label: "Approved" },
  { value: "sent", label: "Sent" },
  { value: "suppressed", label: "Not sending" },
];

const KIND_LABELS: Record<OnboardingReminderKind, string> = {
  student_invite_48h: "Student invite (48h)",
  student_invite_5d: "Student invite (5d, final)",
  admin_stale_7d: "Admin check-in (7d)",
  instructor_review_3d: "Instructor review nudge (3d)",
};

function formatDateTime(ms: number | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

export default function AdminOnboardingRemindersPage(): React.JSX.Element {
  const [status, setStatus] = useState<OnboardingReminderStatus>("pending_review");
  const [cursor, setCursor] = useState<number | undefined>(undefined);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [suppressReason, setSuppressReason] = useState("");
  const [showSuppressForm, setShowSuppressForm] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data, isLoading, error, refetch } = useOnboardingReminders(status, cursor);
  const counts = useOnboardingReminderCounts();
  const items = useMemo(() => data?.items ?? [], [data]);

  const allSelected = items.length > 0 && items.every((item) => selected.has(item._id));

  function toggle(id: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(): void {
    setSelected(allSelected ? new Set() : new Set(items.map((item) => item._id)));
  }

  function toggleExpanded(id: string): void {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(action: "approve" | "suppress"): Promise<void> {
    if (selected.size === 0) return;
    if (action === "suppress" && suppressReason.trim().length === 0) {
      setMessage("Add a reason before marking items as not sending.");
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/onboarding-reminders/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: [...selected],
          action,
          reason: action === "suppress" ? suppressReason.trim() : undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(json.error ?? "Review failed");
        return;
      }
      setMessage(
        action === "approve"
          ? `Approved ${json.updated ?? 0} reminder(s). They send on the next run (usually within a minute).`
          : `Marked ${json.updated ?? 0} reminder(s) as not sending.`
      );
      setSelected(new Set());
      setSuppressReason("");
      setShowSuppressForm(false);
      await refetch();
      await counts.refetch();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container mx-auto max-w-5xl space-y-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" /> Reminder outbox
          </CardTitle>
          <CardDescription>
            Automated onboarding nudges are staged here and never sent until you
            approve them. Marking one &quot;not sending&quot; records the reason and
            stops it being queued again.
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        {STATUS_TABS.map((tab) => (
          <Button
            key={tab.value}
            size="sm"
            variant={status === tab.value ? "default" : "outline"}
            onClick={() => {
              setStatus(tab.value);
              setCursor(undefined);
              setSelected(new Set());
            }}
          >
            {tab.label}
            {tab.value === "pending_review" && counts.data?.pending
              ? ` (${counts.data.pending})`
              : null}
            {tab.value === "suppressed" && counts.data?.suppressed
              ? ` (${counts.data.suppressed})`
              : null}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => void refetch()}>
          <RefreshCw className="mr-1 h-4 w-4" /> Refresh
        </Button>
      </div>

      {message ? (
        <div className="rounded-md border bg-muted/40 p-3 text-sm">{message}</div>
      ) : null}

      {status === "pending_review" && items.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border p-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              aria-label="Select all"
            />
            Select all ({items.length})
          </label>
          <span className="text-sm text-muted-foreground">
            {selected.size} selected
          </span>
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              disabled={busy || selected.size === 0}
              onClick={() => void submit("approve")}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Approve selected"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || selected.size === 0}
              onClick={() => setShowSuppressForm((open) => !open)}
            >
              Not sending…
            </Button>
          </div>
          {showSuppressForm ? (
            <div className="w-full space-y-2">
              <textarea
                className="w-full rounded-md border p-2 text-sm"
                rows={2}
                placeholder="Why should these not be sent? (e.g. already working with the student)"
                value={suppressReason}
                onChange={(event) => setSuppressReason(event.target.value)}
              />
              <Button
                size="sm"
                variant="destructive"
                disabled={busy || suppressReason.trim().length === 0}
                onClick={() => void submit("suppress")}
              >
                Mark {selected.size} as not sending
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading reminders…
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
          {error.message}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nothing {status === "suppressed" ? "held back" : "here"} right now.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item._id}>
              <CardHeader className="space-y-2 pb-3">
                <div className="flex flex-wrap items-start gap-2">
                  {status === "pending_review" ? (
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selected.has(item._id)}
                      onChange={() => toggle(item._id)}
                      aria-label={`Select reminder for ${item.recipient}`}
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{KIND_LABELS[item.kind]}</Badge>
                      <Badge
                        variant={
                          item.status === "suppressed"
                            ? "destructive"
                            : item.status === "sent"
                              ? "secondary"
                              : "default"
                        }
                      >
                        {item.status.replace("_", " ")}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        queued {formatDateTime(item.createdAt)}
                      </span>
                    </div>
                    <div className="mt-1 text-sm font-medium">
                      To {item.recipientName ? `${item.recipientName} ` : ""}
                      &lt;{item.recipient}&gt;
                    </div>
                    <div className="text-sm">{item.subject}</div>
                    <div className="text-xs text-muted-foreground">
                      {item.reason} ·{" "}
                      <Link
                        className="underline"
                        href={`/admin/onboardings/${item.onboardingId}`}
                      >
                        open onboarding
                      </Link>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => toggleExpanded(item._id)}
                  >
                    {expanded.has(item._id) ? "Hide" : "Preview"}
                  </Button>
                </div>
              </CardHeader>
              {expanded.has(item._id) ? (
                <CardContent className="pt-0">
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs">
                    {item.previewText ?? "(no preview)"}
                  </pre>
                </CardContent>
              ) : null}
              {item.status === "suppressed" && item.suppressReason ? (
                <CardContent className="pt-0 text-xs text-destructive">
                  Not sending: {item.suppressReason}
                </CardContent>
              ) : null}
              {item.status === "sent" ? (
                <CardContent className="pt-0 text-xs text-muted-foreground">
                  Sent {formatDateTime(item.sentAt)}
                </CardContent>
              ) : null}
            </Card>
          ))}
          {data?.nextCursor ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCursor(data.nextCursor)}
            >
              Older
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
