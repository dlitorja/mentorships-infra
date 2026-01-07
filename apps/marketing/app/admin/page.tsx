import { requireAdmin } from "@/lib/auth";
import { getAllInstructorsWithInventory } from "@/lib/supabase-inventory";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import { Package } from "lucide-react";

type InventorySummary = {
  oneOnOne: number;
  group: number;
};

export default async function AdminDashboard(): Promise<React.ReactElement> {
  await requireAdmin();

  let instructors: Awaited<ReturnType<typeof getAllInstructorsWithInventory>>;
  try {
    instructors = await getAllInstructorsWithInventory();
  } catch (error) {
    console.error("Error fetching instructors:", error);
    instructors = [];
  }

  const initial: InventorySummary = { oneOnOne: 0, group: 0 };
  const totalInventory = instructors.reduce<InventorySummary>(
    (acc, i) => ({
      oneOnOne: acc.oneOnOne + (i.one_on_one_inventory ?? 0),
      group: acc.group + (i.group_inventory ?? 0),
    }),
    initial
  );

  const outOfStock = instructors.filter(
    (i) => (i.one_on_one_inventory || 0) === 0 && (i.group_inventory || 0) === 0
  ).length;

  return (
    <div>
      <h1 className="text-3xl font-bold mb-8">Admin Dashboard</h1>

      <div className="grid gap-4 md:grid-cols-4 mb-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Total Instructors</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{instructors.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">1-on-1 Spots Available</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totalInventory.oneOnOne}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Group Spots Available</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totalInventory.group}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Out of Stock</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-red-600">{outOfStock}</p>
          </CardContent>
        </Card>
      </div>

      <h2 className="text-xl font-semibold mb-4">Quick Actions</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
          <Link href="/admin/inventory">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                Manage Inventory
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Adjust inventory counts, set up waitlists, and configure offer mappings.
              </p>
            </CardContent>
          </Link>
        </Card>
      </div>
    </div>
  );
}
