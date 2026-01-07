import { requireAdmin } from "@/lib/auth";
import { getAllInstructorsWithInventory } from "@/lib/supabase-inventory";
import { InventoryTable } from "@/components/admin/inventory-table";
import { instructors } from "@/lib/instructors";
import { createHash } from "crypto";

function generateDeterministicId(slug: string): string {
  const hash = createHash("md5").update(slug).digest("hex");
  return `${hash.substring(0, 8)}-${hash.substring(8, 12)}-${hash.substring(12, 16)}-${hash.substring(16, 20)}-${hash.substring(20, 32)}`;
}

export default async function InventoryPage(): Promise<React.ReactElement> {
  await requireAdmin();

  let inventoryData: Awaited<ReturnType<typeof getAllInstructorsWithInventory>>;
  try {
    inventoryData = await getAllInstructorsWithInventory();
  } catch (error) {
    console.error("Error fetching inventory:", error);
    inventoryData = [];
  }
  
  const inventoryMap = new Map(
    inventoryData.map((i) => [i.instructor_slug, i])
  );

  const mergedInstructors = instructors.map((instructor) => {
    const inventory = inventoryMap.get(instructor.slug);
    const hasOneOnOneOffer = instructor.offers.some(o => o.kind === "oneOnOne" && o.active !== false);
    const hasGroupOffer = instructor.offers.some(o => o.kind === "group" && o.active !== false);
    return {
      id: inventory?.id || generateDeterministicId(instructor.slug),
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
