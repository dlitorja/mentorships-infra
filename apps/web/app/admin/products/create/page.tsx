import { requireRole } from "@/lib/auth-helpers";
import { fetchMentors } from "@/lib/queries/api-client";
import { ProductForm } from "../_components/product-form";

export default async function CreateProductPage() {
  await requireRole("admin");
  
  const mentorsData = await fetchMentors();
  const mentors = mentorsData.items || [];

  return (
    <ProductForm
      mode="create"
      mentors={mentors}
      isLoadingMentors={false}
    />
  );
}
