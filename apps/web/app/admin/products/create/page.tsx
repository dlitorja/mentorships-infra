import { redirect } from "next/navigation";
import { requireAuth } from "@mentorships/db";
import { CreateProductForm } from "./create-product-form";

export default async function CreateProductPage() {
  // Require authentication
  try {
    await requireAuth();
  } catch {
    redirect("/sign-in?redirect_url=/admin/products/create");
  }

  return <CreateProductForm />;
}
