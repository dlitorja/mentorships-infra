import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function AuthRedirectPage() {
  const clerkAuth = await auth();
  const session = (clerkAuth as any).session;

  if (!session) {
    redirect("/sign-in");
  }

  const token = await session.getToken();
  if (!token) {
    redirect("/dashboard");
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    redirect("/dashboard");
  }

  try {
    const response = await fetch(`${convexUrl}/api/users/getCurrentUserRole`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.ok) {
      const role = await response.json();
      if (role === "admin") {
        redirect("/admin");
      }
    }
  } catch (error) {
    console.error("Failed to get user role:", error);
  }

  redirect("/dashboard");
}