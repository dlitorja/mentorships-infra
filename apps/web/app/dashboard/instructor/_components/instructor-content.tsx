"use client";

import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Plus, Trash2, ImageIcon } from "lucide-react";
import { apiFetch } from "@/lib/queries/api-client";
import { InstructorImageUpload } from "@/components/admin/instructor-image-upload";

type Testimonial = {
  id: string;
  name: string;
  text: string;
  createdAt: string;
};

type MenteeResult = {
  id: string;
  imageUrl: string | null;
  imageUploadPath: string | null;
  studentName: string | null;
  createdAt: string;
};

type TestimonialsResponse = { items: Testimonial[] };
type MenteeResultsResponse = { items: MenteeResult[] };

async function fetchTestimonials(): Promise<TestimonialsResponse> {
  return apiFetch<TestimonialsResponse>("/api/instructor/testimonials");
}

async function fetchMenteeResults(): Promise<MenteeResultsResponse> {
  return apiFetch<MenteeResultsResponse>("/api/instructor/mentees-results");
}

async function addTestimonial(data: { name: string; text: string }) {
  const response = await fetch("/api/instructor/testimonials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to add testimonial");
  }
  return response.json();
}

async function deleteTestimonial(id: string) {
  const response = await fetch(`/api/instructor/testimonials/${id}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to delete testimonial");
  }
  return response.json();
}

async function addMenteeResult(data: { imageUrl: string; studentName: string }) {
  const response = await fetch("/api/instructor/mentees-results", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to add mentee result");
  }
  return response.json();
}

async function deleteMenteeResult(id: string) {
  const response = await fetch(`/api/instructor/mentees-results/${id}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to delete mentee result");
  }
  return response.json();
}

export function InstructorContent() {
  const [showTestimonialDialog, setShowTestimonialDialog] = useState(false);
  const [showMenteeResultDialog, setShowMenteeResultDialog] = useState(false);
  const [testimonialForm, setTestimonialForm] = useState({ name: "", text: "" });
  const [menteeResultForm, setMenteeResultForm] = useState({ imageUrl: "", studentName: "" });

  const { data: testimonialsData, refetch: refetchTestimonials } = useQuery({
    queryKey: ["instructor-testimonials"],
    queryFn: fetchTestimonials,
  });

  const { data: menteeResultsData, refetch: refetchMenteeResults } = useQuery({
    queryKey: ["instructor-mentee-results"],
    queryFn: fetchMenteeResults,
  });

  const addTestimonialMutation = useMutation({
    mutationFn: addTestimonial,
    onSuccess: () => {
      setShowTestimonialDialog(false);
      setTestimonialForm({ name: "", text: "" });
      refetchTestimonials();
    },
    onError: (error) => {
      alert(error instanceof Error ? error.message : "Failed to add testimonial");
    },
  });

  const deleteTestimonialMutation = useMutation({
    mutationFn: deleteTestimonial,
    onSuccess: () => refetchTestimonials(),
    onError: (error) => {
      alert(error instanceof Error ? error.message : "Failed to delete testimonial");
    },
  });

  const addMenteeResultMutation = useMutation({
    mutationFn: addMenteeResult,
    onSuccess: () => {
      setShowMenteeResultDialog(false);
      setMenteeResultForm({ imageUrl: "", studentName: "" });
      refetchMenteeResults();
    },
    onError: (error) => {
      alert(error instanceof Error ? error.message : "Failed to add mentee result");
    },
  });

  const deleteMenteeResultMutation = useMutation({
    mutationFn: deleteMenteeResult,
    onSuccess: () => refetchMenteeResults(),
    onError: (error) => {
      alert(error instanceof Error ? error.message : "Failed to delete mentee result");
    },
  });

  const testimonials = testimonialsData?.items || [];
  const menteeResults = menteeResultsData?.items || [];

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <div>
                <CardTitle>Testimonials</CardTitle>
                <CardDescription>Showcase student feedback</CardDescription>
              </div>
              <Button size="sm" onClick={() => setShowTestimonialDialog(true)}>
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {testimonials.length === 0 ? (
              <p className="text-muted-foreground text-center py-4 text-sm">No testimonials yet</p>
            ) : (
              <div className="space-y-3">
                {testimonials.map((t) => (
                  <div key={t.id} className="border rounded-lg p-3">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <p className="font-medium text-sm">{t.name}</p>
                        <p className="text-sm text-muted-foreground line-clamp-2">{t.text}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteTestimonialMutation.mutate(t.id)}
                        disabled={deleteTestimonialMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <div>
                <CardTitle>Mentee Results</CardTitle>
                <CardDescription>Before/after images from students</CardDescription>
              </div>
              <Button size="sm" onClick={() => setShowMenteeResultDialog(true)}>
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {menteeResults.length === 0 ? (
              <p className="text-muted-foreground text-center py-4 text-sm">No results yet</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {menteeResults.map((r) => (
                  <div key={r.id} className="relative group">
                    {r.imageUrl ? (
                      <img src={r.imageUrl} alt="Result" className="w-full h-20 object-cover rounded" />
                    ) : (
                      <div className="w-full h-20 bg-muted rounded flex items-center justify-center">
                        <ImageIcon className="h-6 w-6 text-muted-foreground" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Button
                        variant="destructive"
                        size="icon"
                        onClick={() => deleteMenteeResultMutation.mutate(r.id)}
                        disabled={deleteMenteeResultMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    {r.studentName && (
                      <p className="text-xs text-center mt-1 truncate">{r.studentName}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Testimonial Dialog */}
      <Dialog open={showTestimonialDialog} onOpenChange={setShowTestimonialDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Testimonial</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input
                value={testimonialForm.name}
                onChange={(e) => setTestimonialForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Student name"
              />
            </div>
            <div>
              <Label>Testimonial</Label>
              <Textarea
                value={testimonialForm.text}
                onChange={(e) => setTestimonialForm((prev) => ({ ...prev, text: e.target.value }))}
                placeholder="What they said..."
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTestimonialDialog(false)}>Cancel</Button>
            <Button 
              onClick={() => addTestimonialMutation.mutate(testimonialForm)}
              disabled={!testimonialForm.name || !testimonialForm.text || addTestimonialMutation.isPending}
            >
              {addTestimonialMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mentee Result Dialog */}
      <Dialog open={showMenteeResultDialog} onOpenChange={setShowMenteeResultDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Mentee Result</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <InstructorImageUpload
              label="Result Image"
              value={menteeResultForm.imageUrl}
              onChange={(url) => setMenteeResultForm((prev) => ({ ...prev, imageUrl: url }))}
            />
            <div>
              <Label>Student Name (optional)</Label>
              <Input
                value={menteeResultForm.studentName}
                onChange={(e) => setMenteeResultForm((prev) => ({ ...prev, studentName: e.target.value }))}
                placeholder="Student name"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMenteeResultDialog(false)}>Cancel</Button>
            <Button 
              onClick={() => addMenteeResultMutation.mutate(menteeResultForm)}
              disabled={!menteeResultForm.imageUrl || addMenteeResultMutation.isPending}
            >
              {addMenteeResultMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
