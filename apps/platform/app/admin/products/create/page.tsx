"use client";

import { useEffect, useState } from "react";
import { ProductForm } from "../_components/product-form";

type Instructor = {
  id: string;
  email: string | null;
};

export default function CreateProductPage() {
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [isLoadingInstructors, setIsLoadingInstructors] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchInstructors() {
      try {
        const res = await fetch("/api/admin/instructors");
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to fetch instructors");
        }
        const data = await res.json();
        setInstructors(
          (data.instructors || []).map((inst: any) => ({
            id: inst.instructorId,
            email: inst.email || null,
          }))
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load instructors");
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
