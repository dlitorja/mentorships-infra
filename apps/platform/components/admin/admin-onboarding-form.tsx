"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Loader2,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ChevronRight,
} from "lucide-react";
import { apiFetch } from "@/lib/queries/api-client";
import {
  useInstructorOptionsForOnboarding,
  useLookupExistingStudent,
  type InstructorOption,
} from "@/lib/queries/convex/use-admin-onboardings";

const DEFAULT_SESSIONS_PER_INSTRUCTOR = 4;
const DEFAULT_EXPIRES_DAYS = 90;

type PerInstructorDraft = {
  instructorId: string;
  sessionsPerInstructor: number;
  expiresAt: number | undefined;
};

type PreviewPerInstructor = {
  instructorId: string;
  instructorName: string | undefined;
  isRenewal: boolean;
  existingWorkspaceId: string | undefined;
  action: "new_workspace" | "renewal";
  sessionsPerInstructor: number;
  expiresAt: number | undefined;
  atCapacity: boolean;
  activeStudentCount: number;
  maxActiveStudents: number | undefined;
  capacityOverrideRequired: boolean;
};

type PreviewResponse = {
  email: string;
  perInstructor: PreviewPerInstructor[];
  existingStudent: {
    userId: string;
    firstName: string | undefined;
    lastName: string | undefined;
    existingInstructors: string[];
  } | null;
  capacityOverrideRequired: boolean;
  capacityOverrideReasonMissing: boolean;
  notesRequired: boolean;
  notesMissing: boolean;
  warnings: string[];
};

type CommitResponse = {
  onboardingId: string;
  status: "processing";
  clerkInvitationId: string | null;
  perInstructor: Array<{
    instructorId: string;
    workspaceId: string | undefined;
    seatReservationId: string | undefined;
    sessionPackId: string | undefined;
    isRenewal: boolean;
    clerkInvitationId: string | undefined;
  }>;
  existingWorkspaceIds: string[];
};

async function postPreview(body: {
  email: string;
  instructors: PerInstructorDraft[];
  isSeparateStudentRecord: boolean;
  notes?: string;
  capacityOverrideReason?: string;
}): Promise<PreviewResponse> {
  return apiFetch<PreviewResponse>("/api/admin/students/onboard/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function postCommit(body: {
  email: string;
  instructors: PerInstructorDraft[];
  isSeparateStudentRecord: boolean;
  notes?: string;
  capacityOverrideReason?: string;
}): Promise<CommitResponse> {
  const res = await fetch("/api/admin/students/onboard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, source: "kajabi" }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to create onboarding" }));
    throw new Error(err.error || "Failed to create onboarding");
  }
  return res.json();
}

function defaultExpiresAt(): number {
  return Date.now() + DEFAULT_EXPIRES_DAYS * 24 * 60 * 60 * 1000;
}

export default function AdminOnboardingForm() {
  const queryClient = useQueryClient();

  const [email, setEmail] = useState("");
  const [selectedInstructorIds, setSelectedInstructorIds] = useState<string[]>([]);
  const [perInstructor, setPerInstructor] = useState<Record<string, PerInstructorDraft>>({});
  const [isSeparateStudentRecord, setIsSeparateStudentRecord] = useState(false);
  const [advancedModalOpen, setAdvancedModalOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [capacityOverrideReason, setCapacityOverrideReason] = useState("");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResponse | null>(null);
  const [error, setError] = useState("");

  const trimmedEmail = email.trim();
  const isValidEmailShape = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail);

  const { data: instructorOptions, isLoading: isLoadingInstructors } =
    useInstructorOptionsForOnboarding();

  const { data: existingStudent } = useLookupExistingStudent(
    isValidEmailShape ? trimmedEmail : undefined
  );

  // Reset state when the email changes (so banners don't leak between runs).
  useEffect(() => {
    setPreview(null);
    setCommitResult(null);
    setError("");
  }, [trimmedEmail]);

  // Reset preview/commit when the instructor selection changes — the
  // preview is stale once any pair is added or removed.
  useEffect(() => {
    setPreview(null);
  }, [selectedInstructorIds.join(",")]);

  const selectedOptions = useMemo(() => {
    if (!instructorOptions) return [];
    return instructorOptions.filter((o) => selectedInstructorIds.includes(o.id));
  }, [instructorOptions, selectedInstructorIds]);

  const anyAtCapacityInSelection = selectedOptions.some(
    (o) => typeof o.maxActiveStudents === "number" && o.activeStudentCount >= o.maxActiveStudents
  );

  const instructorsPayload: PerInstructorDraft[] = useMemo(() => {
    return selectedInstructorIds.map((id) => {
      const existing = perInstructor[id];
      if (existing) return existing;
      return {
        instructorId: id,
        sessionsPerInstructor: DEFAULT_SESSIONS_PER_INSTRUCTOR,
        expiresAt: defaultExpiresAt(),
      };
    });
  }, [selectedInstructorIds, perInstructor]);

  function toggleInstructor(id: string) {
    setSelectedInstructorIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
    setPerInstructor((prev) => {
      const next = { ...prev };
      if (id in next) {
        delete next[id];
      }
      return next;
    });
  }

  function updateDraft(id: string, patch: Partial<PerInstructorDraft>) {
    setPerInstructor((prev) => {
      const current = prev[id] ?? {
        instructorId: id,
        sessionsPerInstructor: DEFAULT_SESSIONS_PER_INSTRUCTOR,
        expiresAt: defaultExpiresAt(),
      };
      return { ...prev, [id]: { ...current, ...patch } };
    });
  }

  function trySetAdvancedSplit(next: boolean) {
    if (next) {
      setAdvancedModalOpen(true);
      return;
    }
    setIsSeparateStudentRecord(false);
    setNotes("");
  }

  function confirmAdvancedSplit() {
    setIsSeparateStudentRecord(true);
    setAdvancedModalOpen(false);
  }

  function cancelAdvancedSplit() {
    setAdvancedModalOpen(false);
  }

  const previewMutation = useMutation({
    mutationFn: () =>
      postPreview({
        email: trimmedEmail,
        instructors: instructorsPayload,
        isSeparateStudentRecord,
        notes: notes || undefined,
        capacityOverrideReason: capacityOverrideReason || undefined,
      }),
    onSuccess: (data) => {
      setPreview(data);
      setError("");
    },
    onError: (err) => {
      setPreview(null);
      setError(err instanceof Error ? err.message : "Failed to preview onboarding");
    },
  });

  const commitMutation = useMutation({
    mutationFn: () =>
      postCommit({
        email: trimmedEmail,
        instructors: instructorsPayload,
        isSeparateStudentRecord,
        notes: notes || undefined,
        capacityOverrideReason: capacityOverrideReason || undefined,
      }),
    onSuccess: (data) => {
      setCommitResult(data);
      setError("");
      // Refresh the recovery dashboard list so the new row appears.
      queryClient.invalidateQueries({ queryKey: ["admin-onboardings"] });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Failed to create onboarding");
    },
  });

  const canPreview =
    isValidEmailShape &&
    selectedInstructorIds.length > 0 &&
    !previewMutation.isPending;

  const notesMissing = isSeparateStudentRecord && !notes.trim();
  const capacityMissing = anyAtCapacityInSelection && !capacityOverrideReason.trim();
  const canCommit =
    !!preview &&
    !notesMissing &&
    !capacityMissing &&
    !commitResult &&
    !commitMutation.isPending;

  const emailPlan = preview
    ? {
        student: 1,
        instructors: preview.perInstructor.length,
        admin: 1,
      }
    : null;

  return (
    <div className="space-y-4">
      <ExistingStudentBanner existingStudent={existingStudent ?? null} />

      <div className="space-y-2">
        <Label htmlFor="email-onboarding">Student email</Label>
        <Input
          id="email-onboarding"
          type="email"
          placeholder="student@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={commitMutation.isPending}
        />
      </div>

      <div className="space-y-2">
        <Label>Instructors</Label>
        {isLoadingInstructors ? (
          <div className="flex items-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading instructors…
          </div>
        ) : (instructorOptions ?? []).length === 0 ? (
          <div className="text-sm text-muted-foreground">No active instructors found.</div>
        ) : (
          <InstructorMultiSelect
            options={instructorOptions ?? []}
            selectedIds={selectedInstructorIds}
            onToggle={toggleInstructor}
            disabled={commitMutation.isPending}
          />
        )}
      </div>

      {selectedInstructorIds.length > 0 && (
        <div className="space-y-3">
          <Label>Per-instructor details</Label>
          <div className="space-y-2">
            {selectedInstructorIds.map((id) => {
              const opt = (instructorOptions ?? []).find((o) => o.id === id);
              const draft = instructorsPayload.find((d) => d.instructorId === id) ?? {
                instructorId: id,
                sessionsPerInstructor: DEFAULT_SESSIONS_PER_INSTRUCTOR,
                expiresAt: defaultExpiresAt(),
              };
              return (
                <PerInstructorRow
                  key={id}
                  option={opt}
                  draft={draft}
                  onChange={(patch) => updateDraft(id, patch)}
                  disabled={commitMutation.isPending}
                />
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-2 rounded-md border p-3">
        <div className="flex items-start gap-3">
          <Checkbox
            id="advanced-split"
            checked={isSeparateStudentRecord}
            onCheckedChange={(v) => trySetAdvancedSplit(v === true)}
            disabled={commitMutation.isPending}
          />
          <div className="space-y-1 leading-tight">
            <Label htmlFor="advanced-split" className="cursor-pointer">
              Create a separate student record for this email
            </Label>
            <p className="text-xs text-muted-foreground">
              Convex-only split. A new <code>users</code> row is created with an{" "}
              <code>onboardingAlias</code> marker; the Clerk account stays the same.
            </p>
          </div>
        </div>
      </div>

      {anyAtCapacityInSelection && (
        <div className="space-y-2">
          <Label htmlFor="capacity-override-reason">
            Capacity override reason <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="capacity-override-reason"
            placeholder="Why are we onboarding this student despite the instructor being at capacity?"
            value={capacityOverrideReason}
            onChange={(e) => setCapacityOverrideReason(e.target.value)}
            disabled={commitMutation.isPending}
            rows={2}
          />
          <p className="text-xs text-muted-foreground">
            Required because at least one selected instructor is at capacity.
          </p>
        </div>
      )}

      {(isSeparateStudentRecord || anyAtCapacityInSelection) && (
        <div className="space-y-2">
          <Label htmlFor="notes">
            Internal notes{" "}
            {isSeparateStudentRecord && <span className="text-destructive">*</span>}
          </Label>
          <Textarea
            id="notes"
            placeholder="Internal context for the team (required when advanced split is on)."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={commitMutation.isPending}
            rows={3}
          />
        </div>
      )}

      {error && (
        <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{error}</div>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => previewMutation.mutate()}
          disabled={!canPreview}
          className="flex-1"
        >
          {previewMutation.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Previewing…
            </>
          ) : (
            <>
              <Sparkles className="mr-2 h-4 w-4" />
              Preview
            </>
          )}
        </Button>
        <Button
          type="button"
          onClick={() => commitMutation.mutate()}
          disabled={!canCommit}
          className="flex-1"
        >
          {commitMutation.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Submitting…
            </>
          ) : (
            <>
              <ChevronRight className="mr-2 h-4 w-4" />
              Confirm and Send
            </>
          )}
        </Button>
      </div>

      {preview && <PreviewPanel preview={preview} emailPlan={emailPlan} />}

      {commitResult && (
        <CommitResultPanel
          result={commitResult}
          instructorOptions={instructorOptions ?? []}
        />
      )}

      <Dialog open={advancedModalOpen} onOpenChange={setAdvancedModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a separate student record?</DialogTitle>
            <DialogDescription>
              This will create a new <code>users</code> row in Convex tagged with an{" "}
              <code>onboardingAlias</code> marker. The Clerk account stays the same — only
              the Convex-side record is split. You'll be required to leave internal notes
              explaining why.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={cancelAdvancedSplit}>
              Cancel
            </Button>
            <Button onClick={confirmAdvancedSplit}>Continue</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ExistingStudentBanner({
  existingStudent,
}: {
  existingStudent: {
    exists: boolean;
    name: string | undefined;
    onboardingAlias: string | undefined;
    priorOnboardingIds: string[];
  } | null;
}) {
  if (!existingStudent) return null;
  if (!existingStudent.exists && existingStudent.priorOnboardingIds.length === 0) {
    return null;
  }
  if (existingStudent.exists) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-700" />
          <div className="space-y-1">
            <div className="font-medium text-amber-900">
              An account already exists for this email
              {existingStudent.name ? ` — ${existingStudent.name}` : ""}.
            </div>
            <div className="text-xs text-amber-800">
              We'll use the existing student by default. Toggle "Create a separate
              student record" above to split.
            </div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-blue-300 bg-blue-50 p-3 text-sm">
      <div className="flex items-start gap-2">
        <RefreshCw className="mt-0.5 h-4 w-4 text-blue-700" />
        <div className="space-y-1">
          <div className="font-medium text-blue-900">
            {existingStudent.priorOnboardingIds.length} prior onboarding submission
            {existingStudent.priorOnboardingIds.length === 1 ? "" : "s"} for this email.
          </div>
          <div className="text-xs text-blue-800">
            See <Link href="/admin/onboardings" className="underline">/admin/onboardings</Link>{" "}
            to review prior runs.
          </div>
        </div>
      </div>
    </div>
  );
}

function InstructorMultiSelect({
  options,
  selectedIds,
  onToggle,
  disabled,
}: {
  options: InstructorOption[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-1 max-h-64 overflow-y-auto rounded-md border p-2">
      {options.map((opt) => {
        const checked = selectedIds.includes(opt.id);
        const atCapacity =
          typeof opt.maxActiveStudents === "number" &&
          opt.activeStudentCount >= opt.maxActiveStudents;
        return (
          <label
            key={opt.id}
            className={`flex items-center gap-3 rounded px-2 py-1.5 hover:bg-muted/50 ${
              disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
            }`}
          >
            <Checkbox
              checked={checked}
              onCheckedChange={() => onToggle(opt.id)}
              disabled={disabled}
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">
                {opt.name ?? opt.id}
              </div>
              {opt.email && (
                <div className="text-xs text-muted-foreground truncate">
                  {opt.email}
                </div>
              )}
            </div>
            {typeof opt.maxActiveStudents === "number" ? (
              <Badge variant={atCapacity ? "destructive" : "secondary"}>
                {opt.activeStudentCount}/{opt.maxActiveStudents} active
              </Badge>
            ) : (
              <Badge variant="outline">{opt.activeStudentCount} active</Badge>
            )}
          </label>
        );
      })}
    </div>
  );
}

function PerInstructorRow({
  option,
  draft,
  onChange,
  disabled,
}: {
  option: InstructorOption | undefined;
  draft: PerInstructorDraft;
  onChange: (patch: Partial<PerInstructorDraft>) => void;
  disabled: boolean;
}) {
  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">{option?.name ?? draft.instructorId}</div>
        {option && typeof option.maxActiveStudents === "number" && (
          <Badge
            variant={
              option.activeStudentCount >= option.maxActiveStudents
                ? "destructive"
                : "secondary"
            }
          >
            {option.activeStudentCount}/{option.maxActiveStudents} active
          </Badge>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <Label htmlFor={`sessions-${draft.instructorId}`} className="text-xs">
            Sessions
          </Label>
          <Input
            id={`sessions-${draft.instructorId}`}
            type="number"
            min={1}
            value={draft.sessionsPerInstructor}
            onChange={(e) =>
              onChange({ sessionsPerInstructor: Math.max(1, Number(e.target.value || 0)) })
            }
            disabled={disabled}
          />
        </div>
        <div>
          <Label htmlFor={`expires-${draft.instructorId}`} className="text-xs">
            Expires
          </Label>
          <Input
            id={`expires-${draft.instructorId}`}
            type="date"
            value={
              draft.expiresAt
                ? new Date(draft.expiresAt).toISOString().slice(0, 10)
                : ""
            }
            onChange={(e) => {
              const v = e.target.value;
              if (!v) {
                onChange({ expiresAt: undefined });
                return;
              }
              const ts = new Date(`${v}T00:00:00`).getTime();
              onChange({ expiresAt: Number.isFinite(ts) ? ts : undefined });
            }}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}

function PreviewPanel({
  preview,
  emailPlan,
}: {
  preview: PreviewResponse;
  emailPlan: { student: number; instructors: number; admin: number } | null;
}) {
  return (
    <Card className="border-blue-300 bg-blue-50/40">
      <CardHeader>
        <CardTitle className="text-base">Preview</CardTitle>
        <CardDescription>
          Zero side effects so far. Review the per-pair assignments below, then click
          "Confirm and Send".
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          {preview.perInstructor.map((p) => (
            <div
              key={p.instructorId}
              className="flex items-center justify-between rounded border bg-background p-2 text-sm"
            >
              <div>
                <div className="font-medium">{p.instructorName ?? p.instructorId}</div>
                <div className="text-xs text-muted-foreground">
                  Sessions: {p.sessionsPerInstructor} ·{" "}
                  {p.expiresAt
                    ? `Expires ${new Date(p.expiresAt).toLocaleDateString()}`
                    : "No expiration"}
                </div>
              </div>
              <Badge variant={p.action === "renewal" ? "secondary" : "default"}>
                {p.action === "renewal" ? "Renewal" : "New workspace"}
              </Badge>
            </div>
          ))}
        </div>

        {preview.warnings.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs font-medium uppercase text-muted-foreground">
              Warnings
            </div>
            <ul className="space-y-1 text-sm">
              {preview.warnings.map((w) => (
                <li key={w} className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-3 w-3 text-amber-600" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {emailPlan && (
          <div className="rounded border bg-background p-2 text-sm">
            Will send{" "}
            <strong>{emailPlan.student}</strong> student email ·{" "}
            <strong>{emailPlan.instructors}</strong> instructor email
            {emailPlan.instructors === 1 ? "" : "s"} ·{" "}
            <strong>{emailPlan.admin}</strong> admin summary.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CommitResultPanel({
  result,
  instructorOptions,
}: {
  result: CommitResponse;
  instructorOptions: InstructorOption[];
}) {
  return (
    <Card className="border-green-300 bg-green-50/40">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-700" />
          Onboarding submitted
        </CardTitle>
        <CardDescription>
          Status: <Badge>{result.status}</Badge> ·{" "}
          <Link
            href={`/admin/onboardings/${result.onboardingId}`}
            className="underline"
          >
            View detail
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {result.clerkInvitationId && (
          <div className="rounded border bg-background p-2 text-xs text-muted-foreground">
            Clerk invitation: <code>{result.clerkInvitationId}</code>
          </div>
        )}
        <div className="space-y-1">
          {result.perInstructor.map((p) => {
            const opt = instructorOptions.find((o) => o.id === p.instructorId);
            return (
              <div
                key={p.instructorId}
                className="flex items-center justify-between rounded border bg-background p-2"
              >
                <div>
                  <div className="font-medium">{opt?.name ?? p.instructorId}</div>
                  <div className="text-xs text-muted-foreground">
                    {p.isRenewal
                      ? "Renewal (existing workspace)"
                      : p.workspaceId
                        ? `New workspace created`
                        : "No workspace"}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
