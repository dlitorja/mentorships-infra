import { Suspense } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Package, Users, Bell, ShoppingCart } from "lucide-react";
import { AdminStats } from "./admin-stats";
import { AdminInstructorsSection } from "./admin-instructors-section";

function AdminStatsSkeleton(): React.JSX.Element {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="pt-6">
            <div className="flex justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function AdminInstructorsSkeleton(): React.JSX.Element {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminDashboard(): React.JSX.Element {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Admin Dashboard</h1>
        <p className="text-muted-foreground mt-1">Overview of your marketing site</p>
      </div>

      <Suspense fallback={<AdminStatsSkeleton />}>
        <AdminStats />
      </Suspense>

      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <Link href="/admin/inventory">
              <Button variant="outline">
                <Package className="mr-2 h-4 w-4" />
                Manage Inventory
              </Button>
            </Link>
            <Link href="/admin/instructors">
              <Button variant="outline">
                <Users className="mr-2 h-4 w-4" />
                View Instructors
              </Button>
            </Link>
            <Link href="/admin/orders">
              <Button variant="outline">
                <ShoppingCart className="mr-2 h-4 w-4" />
                View Orders
              </Button>
            </Link>
            <Link href="/admin/digest">
              <Button variant="outline">
                <Bell className="mr-2 h-4 w-4" />
                Digest Settings
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      <Suspense fallback={<AdminInstructorsSkeleton />}>
        <AdminInstructorsSection />
      </Suspense>
    </div>
  );
}
