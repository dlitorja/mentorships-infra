"use client";

import { useUser } from "@clerk/nextjs";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import type { JSX } from "react";

export default function SignUpRedirectPage(): JSX.Element {
  const { user, isLoaded } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (!isLoaded) return;

    if (!user) {
      router.push("/sign-in");
      return;
    }

    const roleValue = user.publicMetadata?.role;
    const role = typeof roleValue === "string" ? roleValue.toLowerCase() : "";
    if (role === "admin") {
      router.push("/admin");
    } else if (role === "instructor") {
      router.push("/instructor/dashboard");
    } else {
      router.push("/dashboard");
    }
  }, [isLoaded, user, router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin" />
    </div>
  );
}