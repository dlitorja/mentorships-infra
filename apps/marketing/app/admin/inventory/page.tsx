import { getCurrentUser, ADMIN_EMAIL } from "@/lib/auth";
import { getAllInstructorsWithInventory } from "@/lib/supabase-inventory";
import { InventoryTable } from "@/components/admin/inventory-table";
import { instructors } from "@/lib/instructors";

export default async function InventoryPage() {
  const user = await getCurrentUser();
  
  if (!user) {
    return (
      <div className="text-center py-12">
        <h1 className="text-2xl font-bold mb-4">Sign In Required</h1>
        <p className="text-muted-foreground">Please sign in to access inventory management.</p>
      </div>
    );
  }

  const isAdmin = user.emailAddresses?.[0]?.emailAddress === ADMIN_EMAIL;

  if (!isAdmin) {
    return (
      <div className="text-center py-12">
        <h1 className="text-2xl font-bold mb-4">Access Denied</h1>
        <p className="text-muted-foreground">You do not have permission to access inventory management.</p>
      </div>
    );
  }

  const inventoryData = await getAllInstructorsWithInventory();
  
  // Create a map of slug -> inventory data
  const inventoryMap = new Map(
    inventoryData.map((i) => [i.instructor_slug, i])
  );

  // Merge all instructors with their inventory data
  const mergedInstructors = instructors.map((instructor) => {
    const inventory = inventoryMap.get(instructor.slug);
    const hasOneOnOneOffer = instructor.offers.some(o => o.kind === "oneOnOne" && o.active !== false);
    const hasGroupOffer = instructor.offers.some(o => o.kind === "group" && o.active !== false);
    return {
      id: inventory?.id || crypto.randomUUID(),
      instructor_slug: instructor.slug,
      instructor_name: instructor.name,
      one_on_one_inventory: inventory?.one_on_one_inventory ?? 0,
      group_inventory: inventory?.group_inventory ?? 0,
      has_pricing_one_on_one: hasOneOnOneOffer,
      has_pricing_group: hasGroupOffer,
    };
  });

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">Inventory Management</h1>
      <InventoryTable initialData={mergedInstructors} />
    </div>
  );
}
