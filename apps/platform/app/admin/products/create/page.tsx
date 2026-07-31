"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { ApiFetchError, getAdminInstructors } from "@/lib/queries/api-client";
import { ProductForm } from "../_components/product-form";

const instructorSchema = z.object({
  instructorId: z.string(),
  email: z.string().nullable(),
  displayName: z.string(),
});

const instructorsResponseSchema = z.object({
  instructors: z.array(instructorSchema),
});

type Instructor = {
  id: string;
  email: string | null;
  name: string;
};

export default function CreateProductPage() {
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [isLoadingInstructors, setIsLoadingInstructors] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchInstructors() {
      try {
        const data = await getAdminInstructors();
        const validated = instructorsResponseSchema.parse(data);
        setInstructors(
          validated.instructors.map((inst) => ({
            id: inst.instructorId,
            email: inst.email || null,
            name: inst.displayName,
          }))
        );
      } catch (err) {
        if (err instanceof ApiFetchError && typeof err.data === "object" && err.data !== null && "error" in err.data && typeof err.data.error === "string") {
          setError(err.data.error);
        } else {
          setError(err instanceof Error ? err.message : "Failed to load instructors");
        }
      } finally {
        setIsLoadingInstructors(false);
      }
    }

    fetchInstructors();
  }, []);

  if (error) {
    return (
      <div className="min-h-screen bg-background px-4 py-12">
        <div className="max-w-4xl mx-auto">
          <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded">
            {error}
          </div>
        </div>
      </div>
    );
  }

  return (
    <ProductForm
      mode="create"
      instructors={instructors}
      isLoadingInstructors={isLoadingInstructors}
    />
  );
}
