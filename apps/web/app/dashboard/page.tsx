import { requireDbUser } from "@/lib/auth";
import { UserButton } from "@clerk/nextjs";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  try {
    const user = await requireDbUser();
    
    return (
      <div className="container mx-auto p-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <UserButton afterSignOutUrl="/" />
        </div>
        
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Welcome back!</h2>
          <div className="space-y-2">
            <p><strong>Email:</strong> {user.email}</p>
            <p><strong>Role:</strong> {user.role}</p>
            <p><strong>User ID:</strong> {user.id}</p>
          </div>
        </div>
      </div>
    );
  } catch (error) {
    // If not authenticated, redirect to sign-in
    redirect("/sign-in");
  }
}

