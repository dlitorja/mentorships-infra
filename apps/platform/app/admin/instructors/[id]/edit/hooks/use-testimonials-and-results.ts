'use client';

import { useMutation } from "@tanstack/react-query";
import { createAdminTestimonial, deleteAdminTestimonial, createAdminStudentResult, deleteAdminStudentResult } from "@/lib/queries/api-client";

export function useTestimonialsAndResults({
  instructorId,
  setError,
  refetch,
  setShowTestimonialDialog,
  setShowStudentResultDialog,
  setTestimonialForm,
  setStudentResultForm,
}: {
  instructorId: string;
  setError: (error: string | null) => void;
  refetch: () => Promise<unknown>;
  setShowTestimonialDialog: (show: boolean) => void;
  setShowStudentResultDialog: (show: boolean) => void;
  setTestimonialForm: React.Dispatch<React.SetStateAction<{ name: string; text: string }>>;
  setStudentResultForm: React.Dispatch<React.SetStateAction<{ imageUrl: string; imageUploadPath: string; studentName: string }>>;
}) {
  const addTestimonialMutation = useMutation({
    mutationFn: (data: { name: string; text: string }) => createAdminTestimonial(instructorId, data),
    onSuccess: () => {
      setError(null);
      setShowTestimonialDialog(false);
      setTestimonialForm({ name: "", text: "" });
      refetch();
    },
    onError: (error) => {
      setError(error instanceof Error ? error.message : "Failed to add testimonial");
    },
  });

  const deleteTestimonialMutation = useMutation({
    mutationFn: (testimonialId: string) => deleteAdminTestimonial(instructorId, testimonialId),
    onSuccess: () => {
      setError(null);
      refetch();
    },
    onError: (error) => {
      setError(error instanceof Error ? error.message : "Failed to delete testimonial");
    },
  });

  const addStudentResultMutation = useMutation({
    mutationFn: (data: { imageUrl: string; imageUploadPath: string; studentName: string }) => createAdminStudentResult(instructorId, data),
    onSuccess: () => {
      setError(null);
      setShowStudentResultDialog(false);
      setStudentResultForm({ imageUrl: "", imageUploadPath: "", studentName: "" });
      refetch();
    },
    onError: (error) => {
      setError(error instanceof Error ? error.message : "Failed to add student result");
    },
  });

  const deleteStudentResultMutation = useMutation({
    mutationFn: (resultId: string) => deleteAdminStudentResult(instructorId, resultId),
    onSuccess: () => {
      setError(null);
      refetch();
    },
    onError: (error) => {
      setError(error instanceof Error ? error.message : "Failed to delete student result");
    },
  });

  return {
    addTestimonialMutation,
    deleteTestimonialMutation,
    addStudentResultMutation,
    deleteStudentResultMutation,
  };
}
