"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
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
const EXISTING_STUDENT_LOOKUP_DEBOUNCE_MS = 350;

type PerInstructorDraft = {
  instructorId: string;
  sessionsPerInstructor: number;
  expiresAt: number | undefined;
};

const previewPerInstructorSchema = z.object({
  instructorId: z.string(),
  instructorName: z.string().optional(),
  isRenewal: z.boolean(),
  existingWorkspaceId: z.string().optional(),
  action: z.enum(["new_workspace", "renewal"]),
  sessionsPerInstructor: z.number(),
  expiresAt: z.number().optional(),
  atCapacity: z.boolean(),
  activeStudentCount: z.number(),
  maxActiveStudents: z.number().optional(),
  capacityOverrideRequired: z.boolean(),
});

const previewResponseSchema = z.object({
  email: z.string(),
  perInstructor: z.array(previewPerInstructorSchema),
  existingStudent: z
    .object({
      userId: z.string(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      existingInstructors: z.array(z.string()),
    })
    .nullable(),
  capacityOverrideRequired: z.boolean(),
  capacityOverrideReasonMissing: z.boolean(),
  notesRequired: z.boolean(),
  notesMissing: z.boolean(),
  warnings: z.array(z.string()),
});

const commitResponseSchema = z.object({
  onboardingId: z.string(),
  status: z.union([z.literal("processing"), z.literal("failed")]),
  failureReason: z.string().optional(),
  clerkInvitationId: z.string().nullable(),
  perInstructor: z.array(
    z.object({
      instructorId: z.string(),
      workspaceId: z.string().optional(),
      seatReservationId: z.string().optional(),
      sessionPackId: z.string().optional(),
      isRenewal: z.boolean(),
      clerkInvitationId: z.string().optional(),
    })
  ),
  existingWorkspaceIds: z.array(z.string()),
});

type PreviewPerInstructor = z.infer<typeof previewPerInstructorSchema>;
type PreviewResponse = z.infer<typeof previewResponseSchema>;
type CommitResponse = z.infer<typeof commitResponseSchema>;

async function postPreview(body: {
  email: string;
  instructors: PerInstructorDraft[];
  isSeparateStudentRecord: boolean;
  notes?: string;
  capacityOverrideReason?: string;
}): Promise<PreviewResponse> {
  const raw = await apiFetch<unknown>("/api/admin/students/onboard/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const parsed = previewResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("Preview response did not match expected schema");
  }
  return parsed.data;
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
  const raw = await res.json();
  const parsed = commitResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("Commit response did not match expected schema");
  }
  return parsed.data;
}

function defaultExpiresAt(): number {
  return Date.now() + DEFAULT_EXPIRES_DAYS * 24 * 60 * 60 * 1000;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export default function AdminOnboardingForm(): React.JSX.Element {
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
  const debouncedEmail = useDebouncedValue(trimmedEmail, EXISTING_STUDENT_LOOKUP_DEBOUNCE_MS);

  const { data: instructorOptions, isLoading: isLoadingInstructors } =
    useInstructorOptionsForOnboarding();

  const { data: existingStudent } = useLookupExistingStudent(
    isValidEmailShape && debouncedEmail === trimmedEmail ? debouncedEmail : undefined
  );

  // Reset state when the email changes (so banners don't leak between runs).
  useEffect(() => {
    setPreview(null);
    setCommitResult(null);
    setError("");
  }, [trimmedEmail]);

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

  // Stable fingerprint of the current draft. Preview is stale if this
  // signature differs from the one used to fetch the preview, so we
  // clear it on any change. Greptile P1 / CodeRabbit Major.
  const draftFingerprint = useMemo(() => {
    const sorted = [...instructorsPayload].sort((a, b) =>
      a.instructorId.localeCompare(b.instructorId)
    );
    return JSON.stringify({
      instructors: sorted.map((d) => ({
        instructorId: d.instructorId,
        sessionsPerInstructor: d.sessionsPerInstructor,
        expiresAt: d.expiresAt,
      })),
      isSeparateStudentRecord,
      notes: notes.trim(),
      capacityOverrideReason: capacityOverrideReason.trim(),
    });
  }, [instructorsPayload, isSeparateStudentRecord, notes, capacityOverrideReason]);

  const prevFingerprintRef = useRef<string | null>(null);
  useEffect(() => {
    if (preview && prevFingerprintRef.current !== null && prevFingerprintRef.current !== draftFingerprint) {
      setPreview(null);
    }
    prevFingerprintRef.current = draftFingerprint;
  }, [draftFingerprint, preview]);

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
      prevFingerprintRef.current = draftFingerprint;
      setError("");
    },
    onError: (err) => {
      setPreview(null);
      prevFingerprintRef.current = null;
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
      queryClient.invalidateQueries({ queryKey: ["admin-onboardings"] });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Failed to create onboarding");
    },
  });

  const canPreview =
    isValidEmailShape &&
    selectedInstructorIds.length > 0 &&
    !previewMutation.isPending &&
    !commitResult;

  // Commit gating honors the authoritative server-side preview flags
  // (capacityOverrideRequired, notesRequired) so the form can't be
  // submitted when server capacity differs from cached options.
  const notesMissing =
    (preview?.notesRequired ?? isSeparateStudentRecord) && !notes.trim();
  const capacityMissing =
    (preview?.capacityOverrideRequired ?? anyAtCapacityInSelection) &&
    !capacityOverrideReason.trim();
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

  const showCapacityOverrideField =
    preview?.capacityOverrideRequired ?? anyAtCapacityInSelection;
  const showNotesField =
    (preview?.notesRequired ?? isSeparateStudentRecord) || showCapacityOverrideField;

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

      {showCapacityOverrideField && (
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
            {preview
              ? "Required per server preview (capacity flag)."
              : "Required because at least one selected instructor is at capacity."}
          </p>
        </div>
      )}

      {showNotesField && (
        <div className="space-y-2">
          <Label htmlFor="notes">
            Internal notes{" "}
            {((preview?.notesRequired ?? isSeparateStudentRecord) || showCapacityOverrideField) && (
              <span className="text-destructive">*</span>
            )}
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
}): React.JSX.Element | null {
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
}): React.JSX.Element {
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
}): React.JSX.Element {
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
}): React.JSX.Element {
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
}): React.JSX.Element {
  const failed = result.status === "failed";
  return (
    <Card
      className={
        failed
          ? "border-amber-300 bg-amber-50/40"
          : "border-green-300 bg-green-50/40"
      }
    >
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          {failed ? (
            <AlertTriangle className="h-4 w-4 text-amber-700" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-green-700" />
          )}
          {failed ? "Onboarding needs attention" : "Onboarding submitted"}
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
        {failed && result.failureReason && (
          <div className="rounded border border-amber-300 bg-background p-2 text-xs text-amber-900">
            {result.failureReason}
          </div>
        )}
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
