import { Suspense } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AdminStats } from "./admin-stats";
import { AdminInstructorsSection } from "./admin-instructors-section";
import { EmailHealthSummaryCard } from "./email-health-summary-card";

export default function AdminDashboard() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Admin Dashboard</h1>
        <p className="text-muted-foreground mt-1">Overview of your platform</p>
      </div>

      <AdminStats />

      <Suspense fallback={null}>
        <EmailHealthSummaryCard />
      </Suspense>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <Link href="/admin/products/create">
              <Button variant="outline">Create New Product</Button>
            </Link>
            <Link href="/admin/orders">
              <Button variant="outline">View All Orders</Button>
            </Link>
            <Link href="/admin/products">
              <Button variant="outline">Manage Products</Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      <AdminInstructorsSection />
    </div>
  );
}
