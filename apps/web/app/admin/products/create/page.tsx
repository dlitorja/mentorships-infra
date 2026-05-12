"use client";

import { useQuery } from "@tanstack/react-query";
import { ProductForm } from "../_components/product-form";

export default function CreateProductPage() {
  const { data: instructorsData, isLoading: isLoadingInstructors } = useQuery({
    queryKey: ["instructors"],
    queryFn: async () => {
      const res = await fetch("/api/admin/instructors");
      if (!res.ok) throw new Error("Failed to fetch instructors");
      return res.json();
    },
  });

  const instructors = (instructorsData?.instructors || []).map((inst: any) => ({
    id: inst.instructorId,
    email: inst.email || null,
  }));

  return (
    <ProductForm
      mode="create"
      instructors={instructors}
      isLoadingInstructors={isLoadingInstructors}
    />
  );
}
