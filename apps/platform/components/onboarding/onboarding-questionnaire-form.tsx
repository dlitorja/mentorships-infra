"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Trash2, Upload, Image as ImageIcon, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/queries/api-client";
import { ApiRoutes } from "@/lib/routes";
import {
  ONBOARDING_AUTOSAVE_DEBOUNCE_MS,
  MAX_WORK_EXAMPLE_BYTES,
  MAX_WORK_EXAMPLES_PER_ONBOARDING,
  MIN_WORK_EXAMPLES_PER_SUBMISSION,
  MIN_INSPIRATIONS,
  MAX_INSPIRATIONS,
  ONBOARDING_REQUIRED_QUESTION_IDS,
  WORK_EXAMPLE_ALLOWED_MIME,
} from "@/lib/workspace-constants";
import {
  ONBOARDING_QUESTIONS,
  type OnboardingInspirationsQuestion,
  type OnboardingTextareaQuestion,
} from "@/lib/onboarding-questions";

type WorkExample = {
  _id: string;
  status: "pending" | "active" | "deleted";
  fileName: string;
  contentType: string;
  b2Key: string;
  fileId: string;
  uploadedAt: number;
};

type Submission = {
  _id: string;
  onboardingId: string;
  status: "draft" | "submitted";
  version: number;
  answers: { questionId: string; answerText: string }[];
  inspirations: { name: string }[];
  lastSeenAt: number | undefined;
  reminderCount: number;
  lastReminderSentAt: number | undefined;
  submittedAt: number | undefined;
};

type InitialState = {
  submission: Submission | null;
  workExamples: WorkExample[];
};

const WORK_EXAMPLE_ALLOWED_MIME_LIST = WORK_EXAMPLE_ALLOWED_MIME as readonly string[];

const inspirationsQuestion: OnboardingInspirationsQuestion = ONBOARDING_QUESTIONS.find(
  (q): q is OnboardingInspirationsQuestion => q.type === "inspirations"
)!;
const textareaQuestions: OnboardingTextareaQuestion[] = ONBOARDING_QUESTIONS.filter(
  (q): q is OnboardingTextareaQuestion => q.type === "textarea"
);

/**
 * Student-facing onboarding questionnaire form.
 *
 * Renders three textarea questions plus an inspirations array (3–4
 * entries) plus a work-example image grid (4–6 active uploads). Auto-
 * saves the text fields + inspirations on a debounce; image uploads
 * commit immediately per file. Submission requires all required
 * question IDs to have a non-empty answer, the inspirations count to
 * be at least MIN_INSPIRATIONS, and at least
 * MIN_WORK_EXAMPLES_PER_SUBMISSION active work examples. The server
 * `submitQuestionnaire` re-checks the same conditions authoritatively.
 *
 * Sends a `sendBeacon` to `/api/onboarding/[id]/abandoned` on
 * `beforeunload` so the abandonment reminder cron has an accurate
 * `lastSeenAt` to compare against.
 */
export default function OnboardingQuestionnaireForm({
  onboardingId,
  initial,
}: {
  onboardingId: string;
  initial: InitialState;
}): React.JSX.Element {
  const router = useRouter();
  const [submission, setSubmission] = useState<Submission | null>(initial.submission);
  // Greptile P1 #9: listWorkExamples now returns status + fileName
  // for every non-deleted row, so a pending-but-still-saved row
  // survives a reload and renders in the grid.
  const [workExamples, setWorkExamples] = useState<WorkExample[]>(
    initial.workExamples.filter((w) => w.status !== "deleted")
  );
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const a of initial.submission?.answers ?? []) m[a.questionId] = a.answerText;
    return m;
  });
  const [inspirations, setInspirations] = useState<{ name: string }[]>(
    initial.submission?.inspirations?.length
      ? initial.submission.inspirations
      : Array.from({ length: MIN_INSPIRATIONS }, () => ({ name: "" }))
  );

  const alreadySubmitted = submission?.status === "submitted";

  // Auto-save (debounced) when answers or inspirations change.
  const lastSavePayload = useRef<string>("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveMutation = useMutation({
    mutationFn: () => {
      const trimmedAnswers = textareaQuestions
        .map((q) => ({
          questionId: q.id,
          answerText: (answers[q.id] ?? "").trim(),
        }))
        .filter((a) => a.answerText.length > 0);
      return apiFetch<{ submission: Submission }>(
        ApiRoutes.onboardingQuestionnaire(onboardingId),
        {
          method: "PATCH",
          body: JSON.stringify({
            answers: trimmedAnswers,
            inspirations: inspirations.filter((i) => i.name.trim().length > 0),
          }),
        }
      );
    },
    onSuccess: ({ submission: next }) => setSubmission(next),
    onError: (err) => {
      // Auto-save failures are non-fatal; surface a soft toast so
      // the student knows their draft may be stale on reload.
      toast.error("Auto-save failed", {
        description: err instanceof Error ? err.message : "Try saving manually.",
      });
    },
  });

  const answersRef = useRef(answers);
  const inspirationsRef = useRef(inspirations);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);
  useEffect(() => {
    inspirationsRef.current = inspirations;
  }, [inspirations]);

  useEffect(() => {
    if (alreadySubmitted) return;
    const payload = JSON.stringify({ answers, inspirations });
    if (payload === lastSavePayload.current) return;
    lastSavePayload.current = payload;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      saveMutation.mutate();
    }, ONBOARDING_AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [answers, inspirations, alreadySubmitted, saveMutation]);

  // Beacon on tab close — fires lastSeenAt so the cron has fresh data.
  useEffect(() => {
    if (alreadySubmitted) return;
    const sendBeacon = () => {
      try {
        const url = ApiRoutes.onboardingAbandoned(onboardingId);
        // sendBeacon with POST + empty body so the request lands even
        // as the page is unloading.
        void fetch(url, {
          method: "POST",
          keepalive: true,
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
      } catch {
        // ignore — best-effort
      }
    };
    window.addEventListener("beforeunload", sendBeacon);
    return () => window.removeEventListener("beforeunload", sendBeacon);
  }, [onboardingId, alreadySubmitted]);

  // Image uploads
  const uploadFile = useCallback(
    async (file: File) => {
      if (file.size > MAX_WORK_EXAMPLE_BYTES) {
        toast.error("Image too large", {
          description: `Max ${Math.round(MAX_WORK_EXAMPLE_BYTES / (1024 * 1024))} MB.`,
        });
        return;
      }
      if (!WORK_EXAMPLE_ALLOWED_MIME_LIST.includes(file.type)) {
        toast.error("Unsupported image type", {
          description: `Use ${WORK_EXAMPLE_ALLOWED_MIME_LIST.join(", ")}.`,
        });
        return;
      }
      if (workExamples.length >= MAX_WORK_EXAMPLES_PER_ONBOARDING) {
        toast.error("Too many images", {
          description: `Max ${MAX_WORK_EXAMPLES_PER_ONBOARDING} work examples.`,
        });
        return;
      }
      try {
        const minted = await apiFetch<{
          uploadUrl: string;
          workExampleId: string;
          fileId: string;
        }>(ApiRoutes.onboardingWorkExampleUploadUrl(onboardingId), {
          method: "POST",
          body: JSON.stringify({
            fileName: file.name,
            contentType: file.type,
            size: file.size,
          }),
        });
        const putRes = await fetch(minted.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!putRes.ok) {
          toast.error("Upload failed", {
            description: `B2 returned HTTP ${putRes.status}`,
          });
          return;
        }
        await apiFetch(ApiRoutes.onboardingWorkExamples(onboardingId), {
          method: "POST",
          body: JSON.stringify({
            workExampleId: minted.workExampleId,
          }),
        });
        setWorkExamples((prev) => [
          ...prev,
          {
            _id: minted.workExampleId,
            status: "active",
            fileName: file.name,
            contentType: file.type,
            b2Key: "",
            fileId: minted.fileId,
            uploadedAt: Date.now(),
          },
        ]);
        toast.success("Uploaded");
      } catch (err) {
        toast.error("Upload failed", {
          description: err instanceof Error ? err.message : "Try again.",
        });
      }
    },
    [onboardingId, workExamples.length]
  );

  const deleteExample = useCallback(
    async (exampleId: string) => {
      try {
        await apiFetch(ApiRoutes.onboardingWorkExample(onboardingId, exampleId), {
          method: "DELETE",
        });
        setWorkExamples((prev) => prev.filter((w) => w._id !== exampleId));
      } catch (err) {
        toast.error("Delete failed", {
          description: err instanceof Error ? err.message : "Try again.",
        });
      }
    },
    [onboardingId]
  );

  // Submit gate (client-side preview; server is authoritative).
  //
  // Greptile P1 #8: required coverage used to be checked against
  // `answers[inspirations]`, but the inspirations inputs update the
  // separate `inspirations` state — never `answers`. So that branch
  // was always missing, and submit stayed disabled even when every
  // required field was filled. The fix: treat `inspirations` as its
  // own required set, alongside the textarea required ids.
  const validInspirations = useMemo(
    () => inspirations.filter((i) => i.name.trim().length > 0),
    [inspirations]
  );
  const missingTextareaRequired = useMemo(
    () =>
      ONBOARDING_REQUIRED_QUESTION_IDS.filter(
        (id) => id !== "inspirations" && !(answers[id] ?? "").trim()
      ),
    [answers]
  );
  const canSubmit =
    missingTextareaRequired.length === 0 &&
    validInspirations.length >= MIN_INSPIRATIONS &&
    workExamples.filter((w) => w.status !== "deleted").length >=
      MIN_WORK_EXAMPLES_PER_SUBMISSION;

  const submitMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ submission: Submission }>(
        ApiRoutes.onboardingQuestionnaireSubmit(onboardingId),
        {
          method: "POST",
          body: JSON.stringify({
            answers: textareaQuestions.map((q) => ({
              questionId: q.id,
              answerText: (answers[q.id] ?? "").trim(),
            })),
            inspirations: validInspirations,
          }),
        }
      ),
    onSuccess: ({ submission: next }) => {
      setSubmission(next);
      toast.success("Questionnaire submitted", {
        description: "Your instructor will review it before your first call.",
      });
      router.refresh();
    },
    onError: (err) => {
      toast.error("Submit failed", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    },
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>About you</CardTitle>
          <CardDescription>
            Your instructor reads these answers before your first call so they
            can prepare a session that&apos;s useful for you.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {textareaQuestions.map((q: OnboardingTextareaQuestion) => (
            <div key={q.id} className="space-y-2">
              <Label htmlFor={`q-${q.id}`}>
                {q.label}
                {ONBOARDING_REQUIRED_QUESTION_IDS.some((id) => id === q.id) && (
                  <span className="ml-1 text-destructive">*</span>
                )}
              </Label>
              {q.helpText && (
                <p className="text-xs text-muted-foreground">{q.helpText}</p>
              )}
              <Textarea
                id={`q-${q.id}`}
                value={answers[q.id] ?? ""}
                onChange={(e) =>
                  setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))
                }
                placeholder={q.placeholder}
                maxLength={q.maxLength}
                rows={q.id === "goals" ? 6 : 4}
                disabled={alreadySubmitted}
              />
              <p className="text-xs text-muted-foreground text-right">
                {(answers[q.id] ?? "").length} / {q.maxLength}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{inspirationsQuestion.label}</CardTitle>
          <CardDescription>{inspirationsQuestion.helpText}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {inspirations.map((entry, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <Input
                value={entry.name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  setInspirations((prev) =>
                    prev.map((x, i) => (i === idx ? { name: e.target.value } : x))
                  );
                }}
                placeholder={`Inspiration ${idx + 1}`}
                maxLength={120}
                disabled={alreadySubmitted}
              />
              {inspirations.length > MIN_INSPIRATIONS && !alreadySubmitted && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    setInspirations((prev) => prev.filter((_, i) => i !== idx))
                  }
                  aria-label="Remove inspiration"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
          {!alreadySubmitted &&
            inspirations.length < MAX_INSPIRATIONS && (
              <Button
                variant="outline"
                onClick={() =>
                  setInspirations((prev) => [...prev, { name: "" }])
                }
              >
                Add inspiration
              </Button>
            )}
          <p className="text-xs text-muted-foreground">
            {validInspirations.length} of {MIN_INSPIRATIONS}–{MAX_INSPIRATIONS}{" "}
            filled.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Work examples</CardTitle>
          <CardDescription>
            Upload {MIN_WORK_EXAMPLES_PER_SUBMISSION}–{MAX_WORK_EXAMPLES_PER_ONBOARDING}{" "}
            images of your recent work. Your instructor uses these to
            personalize your first call.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {activeWorkExamples.map((w) => (
              <div
                key={w._id}
                className="relative aspect-square overflow-hidden rounded-md border bg-muted"
              >
                <div className="flex h-full w-full items-center justify-center">
                  <ImageIcon className="h-8 w-8 text-muted-foreground" />
                </div>
                <div className="absolute inset-x-0 bottom-0 bg-background/80 px-2 py-1 text-xs">
                  <span className="line-clamp-1">{w.fileName}</span>
                </div>
                {!alreadySubmitted && (
                  <button
                    type="button"
                    onClick={() => deleteExample(w._id)}
                    className="absolute right-1 top-1 rounded bg-background/80 p-1 text-destructive hover:bg-background"
                    aria-label="Remove image"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
            {!alreadySubmitted && activeWorkExamples.length < MAX_WORK_EXAMPLES_PER_ONBOARDING && (
              <WorkExampleUploadTile onFile={uploadFile} />
            )}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {activeWorkExamples.length} of {MIN_WORK_EXAMPLES_PER_SUBMISSION}–{MAX_WORK_EXAMPLES_PER_ONBOARDING}{" "}
            uploaded. Max {Math.round(MAX_WORK_EXAMPLE_BYTES / (1024 * 1024))} MB
            per file. {WORK_EXAMPLE_ALLOWED_MIME_LIST.join(", ")}.
          </p>
        </CardContent>
      </Card>

      {!alreadySubmitted && (
        <Card>
          <CardHeader>
            <CardTitle>Submit</CardTitle>
            <CardDescription>
              We&apos;ll send this to your instructor before your first call.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <SubmitChecklist
              missingRequired={missingTextareaRequired}
              validInspirations={validInspirations.length}
              minInspirations={MIN_INSPIRATIONS}
              activeWorkExamples={workExamples.filter((w) => w.status !== "deleted").length}
              minWorkExamples={MIN_WORK_EXAMPLES_PER_SUBMISSION}
            />
            <Button
              onClick={() => submitMutation.mutate()}
              disabled={!canSubmit || submitMutation.isPending}
            >
              {submitMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Submit questionnaire
            </Button>
            {saveMutation.isPending && (
              <p className="text-xs text-muted-foreground">Saving draft…</p>
            )}
            {!saveMutation.isPending && submission && (
              <p className="text-xs text-muted-foreground">Draft saved.</p>
            )}
          </CardContent>
        </Card>
      )}

      {alreadySubmitted && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              Submitted
            </CardTitle>
            <CardDescription>
              Your instructor has your answers. We&apos;ll email when your
              first call is scheduled.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}

function WorkExampleUploadTile({
  onFile,
}: {
  onFile: (file: File) => void;
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      className="flex aspect-square items-center justify-center rounded-md border-2 border-dashed text-muted-foreground hover:border-foreground hover:text-foreground"
    >
      <Upload className="h-6 w-6" />
      <input
        ref={inputRef}
        type="file"
        accept={WORK_EXAMPLE_ALLOWED_MIME_LIST.join(",")}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </button>
  );
}

function SubmitChecklist({
  missingRequired,
  validInspirations,
  minInspirations,
  activeWorkExamples,
  minWorkExamples,
}: {
  missingRequired: string[];
  validInspirations: number;
  minInspirations: number;
  activeWorkExamples: number;
  minWorkExamples: number;
}): React.JSX.Element {
  const items = [
    {
      ok: missingRequired.length === 0,
      label: "All required questions answered",
      detail:
        missingRequired.length === 0
          ? undefined
          : `${missingRequired.length} question${missingRequired.length === 1 ? "" : "s"} still empty`,
    },
    {
      ok: validInspirations >= minInspirations,
      label: `At least ${minInspirations} inspirations`,
      detail: `${validInspirations} filled`,
    },
    {
      ok: activeWorkExamples >= minWorkExamples,
      label: `At least ${minWorkExamples} work examples`,
      detail: `${activeWorkExamples} uploaded`,
    },
  ];
  return (
    <ul className="space-y-1 text-sm">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-2">
          {it.ok ? (
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          )}
          <span>{it.label}</span>
          {it.detail && (
            <Badge variant="outline" className="ml-auto">
              {it.detail}
            </Badge>
          )}
        </li>
      ))}
    </ul>
  );
}
