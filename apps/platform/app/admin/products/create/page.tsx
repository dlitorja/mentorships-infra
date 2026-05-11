"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchMentors } from "@/lib/queries/api-client";
import { ProductForm } from "../_components/product-form";

export default function CreateProductPage() {
  const { data: mentorsData, isLoading: isLoadingMentors } = useQuery({
    queryKey: ["mentors"],
    queryFn: fetchMentors,
  });

  const mentors = mentorsData?.items || [];

  return (
    <ProductForm
      mode="create"
      mentors={mentors}
      isLoadingMentors={isLoadingMentors}
    />
  );
}
