'use client';

import { useMutation } from "@tanstack/react-query";
import { ApiRoutes } from "@/lib/routes";
import type { InstructorFormData, UpdateInstructorResponse, ActiveProduct } from "../types";
import { ApiError, updateInstructorResponseSchema } from "../types";

export function useUpdateInstructor({
  instructorId,
  setError,
  setDeactivationResults,
  setSuccessMessage,
  setShowSuccessDialog,
  setActiveProducts,
  setShowProductDeactivationDialog,
  refetch,
}: {
  instructorId: string;
  setError: (error: string | null) => void;
  setDeactivationResults: React.Dispatch<React.SetStateAction<{
    stripeSuccess: string[];
    stripeFailed: { id: string; error: string }[];
  } | null>>;
  setSuccessMessage: (message: string) => void;
  setShowSuccessDialog: (show: boolean) => void;
  setActiveProducts: React.Dispatch<React.SetStateAction<ActiveProduct[]>>;
  setShowProductDeactivationDialog: (show: boolean) => void;
  refetch: () => Promise<unknown>;
}) {
  return useMutation({
    mutationFn: ({ data, deactivateProducts }: { data: Partial<InstructorFormData>; deactivateProducts: boolean }) =>
      updateInstructor(instructorId, data, deactivateProducts),
    onSuccess: (result) => {
      setError(null);
      if (result.productsDeactivated) {
        setDeactivationResults(result.productsDeactivated);
        setSuccessMessage(
          result.productsDeactivated.stripeFailed.length > 0
            ? "Instructor deactivated, but some products failed to deactivate on Stripe."
            : "Instructor and all products have been deactivated on Stripe."
        );
        setShowSuccessDialog(true);
      } else {
        setSuccessMessage("Instructor updated successfully");
        setDeactivationResults(null);
        setShowSuccessDialog(true);
      }
      refetch();
    },
    onError: (error: Error) => {
      const response = error instanceof ApiError ? error.response : undefined;
      if (response?.requiresProductDeactivation) {
        setActiveProducts((response.activeProducts as ActiveProduct[]) || []);
        setShowProductDeactivationDialog(true);
      } else if (response?.activeStudentCount) {
        setError(`Cannot deactivate instructor: ${response.activeStudentCount} active student(s) with remaining sessions.`);
      } else {
        setError(error.message || "Failed to update instructor");
      }
    },
  });
}

export async function updateInstructor(
  id: string,
  data: Partial<InstructorFormData>,
  deactivateProducts: boolean = false
): Promise<UpdateInstructorResponse> {
  const payload = {
    ...data,
    deactivateProducts,
  };

  const response = await fetch(ApiRoutes.adminInstructor(id), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const result = await response.json();

  if (!response.ok) {
    throw new ApiError(
      result.error || "Failed to update instructor",
      result,
      response.status
    );
  }

  return updateInstructorResponseSchema.parse(result);
}
