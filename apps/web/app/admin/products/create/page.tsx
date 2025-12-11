import { requireRole } from "@/lib/auth-helpers";
import { CreateProductForm } from "./create-product-form";

export default async function CreateProductPage() {
  // requireRole handles auth errors internally by redirecting
  // If it returns, user is authenticated and has admin role
  await requireRole("admin");
  return <CreateProductForm />;
}
