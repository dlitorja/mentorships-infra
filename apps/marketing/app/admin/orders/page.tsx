"use client";

import { OrdersTable } from "@/components/admin/orders-table";

export default function AdminOrdersPage() {
  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">Orders</h1>
      <OrdersTable />
    </div>
  );
}
