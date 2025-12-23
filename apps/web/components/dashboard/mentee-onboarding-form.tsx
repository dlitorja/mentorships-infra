"use client";

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { uploadOnboardingImages, submitOnboarding } from "@/lib/queries/api-client";

type PackOption = {
  sessionPackId: string;
  instructorLabel: string;
};

type UploadedImage = { path: string; mimeType: string; sizeBytes: number };

export function MenteeOnboardingForm({ packs }: { packs: PackOption[] }) {
  const [sessionPackId, setSessionPackId] = useState<string>(packs[0]?.sessionPackId ?? "");
  const [goals, setGoals] = useState<string>("");
  const [files, setFiles] = useState<File[]>([]);
  const [submissionId, setSubmissionId] = useState<string | null>(null);

  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  // Upload images mutation
  const uploadImagesMutation = useMutation({
    mutationFn: (formData: FormData) => uploadOnboardingImages(formData),
    onSuccess: (data) => {
      // Store server-generated submissionId
      setSubmissionId(data.submissionId);
      setUploadedImages(data.images);
      setMessage("Images uploaded. You can now submit onboarding.");
    },
    onError: () => {
      setMessage("Upload failed");
    },
  });

  // Submit onboarding mutation
  const submitOnboardingMutation = useMutation({
    mutationFn: () =>
      submitOnboarding({
        submissionId: submissionId!,
        sessionPackId,
        goals,
        imageObjects: uploadedImages,
      }),
    onSuccess: () => {
      setMessage("Submitted! Your instructor will be notified.");
    },
    onError: (error) => {
      setMessage(error instanceof Error ? error.message : "Submission failed");
    },
  });

  const uploading = uploadImagesMutation.isPending;
  const submitting = submitOnboardingMutation.isPending;

  const canUpload = files.length >= 1 && files.length <= 4 && !uploading && !submitting;
  const canSubmit =
    goals.trim().length >= 10 &&
    sessionPackId.length > 0 &&
    uploadedImages.length >= 2 &&
    uploadedImages.length <= 4 &&
    !uploading &&
    !submitting;

  const fileHelp = useMemo(() => {
    if (files.length === 0) return "Select 2–4 images (JPG/PNG/WebP).";
    if (files.length === 1) return "Add at least 1 more image (2–4 required).";
    if (files.length > 4) return "Too many files selected (max 4).";
    return `${files.length} selected.`;
  }, [files.length]);

  async function uploadImages() {
    setMessage(null);
    if (!canUpload) return;

    const form = new FormData();
    // Don't send submissionId - server will generate it to prevent race conditions
    for (const f of files) form.append("files", f);

    uploadImagesMutation.mutate(form);
  }

  async function submit() {
    setMessage(null);
    if (!canSubmit || !submissionId) {
      setMessage("Please upload images first");
      return;
    }

    submitOnboardingMutation.mutate();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mentee onboarding</CardTitle>
        <CardDescription>
          Tell your instructor what you want to achieve and share 2–4 current work images.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="pack">Mentorship pack</Label>
          <select
            id="pack"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={sessionPackId}
            onChange={(e) => setSessionPackId(e.target.value)}
          >
            {packs.map((p) => (
              <option key={p.sessionPackId} value={p.sessionPackId}>
                {p.instructorLabel}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            If you have multiple instructors, pick the one this onboarding is for.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="goals">Your goals</Label>
          <Textarea
            id="goals"
            value={goals}
            onChange={(e) => setGoals(e.target.value)}
            placeholder="Example: I want portfolio feedback for game art roles, help with composition, and a weekly plan to improve anatomy."
            rows={8}
          />
          <p className="text-xs text-muted-foreground">Minimum 10 characters.</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="images">Work images (2–4)</Label>
          <Input
            id="images"
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
          <p className="text-xs text-muted-foreground">{fileHelp}</p>
          <div className="flex items-center gap-2">
            <Button type="button" onClick={uploadImages} disabled={!canUpload}>
              {uploading ? "Uploading..." : uploadedImages.length > 0 ? "Re-upload images" : "Upload images"}
            </Button>
            {uploadedImages.length > 0 ? (
              <span className="text-xs text-muted-foreground">
                {uploadedImages.length} uploaded
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" onClick={submit} disabled={!canSubmit || !submissionId}>
            {submitting ? "Submitting..." : "Submit onboarding"}
          </Button>
          {submissionId ? (
            <span className="text-xs text-muted-foreground">Submission ID: {submissionId}</span>
          ) : null}
        </div>

        {message ? <p className="text-sm">{message}</p> : null}
      </CardContent>
    </Card>
  );
}


