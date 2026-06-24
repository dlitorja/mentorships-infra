"use client";

import { useState, useEffect } from "react";
import { useSignUp } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";

export default function SignUpPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signUp, isLoaded, setActive } = useSignUp();

  const ticket = searchParams.get("__clerk_ticket");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (signUp?.status === "complete") {
      router.push("/dashboard");
    }
  }, [signUp?.status, router]);

  if (!isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900">
        <p className="text-slate-400">Loading...</p>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4 text-slate-100">No Invitation Found</h1>
          <p className="text-slate-400 mb-4">
            This page is only accessible through an invitation link.
          </p>
          <button
            onClick={() => router.push("/")}
            className="px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signUp) return;

    setError(null);
    setIsSubmitting(true);

    try {
      await signUp.create({
        strategy: "ticket",
        ticket,
        firstName,
        lastName,
        password,
      });

      if (signUp.status === "complete") {
        await setActive({ session: signUp.createdSessionId });
        router.push("/dashboard");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to process invitation";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900">
      <div className="w-full max-w-md p-8 bg-slate-800 rounded-lg shadow-md border border-slate-700">
        <h1 className="text-2xl font-bold mb-6 text-center text-slate-100">Complete Your Sign Up</h1>
        <p className="text-slate-400 mb-6 text-center text-sm">
          Your email has been verified through the invitation. Please create a password to complete your account.
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 text-red-400 rounded text-sm border border-red-500/30">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="firstName" className="block text-sm font-medium text-slate-300 mb-1">
              First Name
            </label>
            <input
              id="firstName"
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-100"
              required
            />
          </div>
          <div>
            <label htmlFor="lastName" className="block text-sm font-medium text-slate-300 mb-1">
              Last Name
            </label>
            <input
              id="lastName"
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-100"
              required
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-300 mb-1">
              Create Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-100"
              required
              minLength={8}
            />
            <p className="text-xs text-slate-500 mt-1">Minimum 8 characters</p>
          </div>
          <button
            type="submit"
            disabled={isSubmitting || !firstName || !lastName || !password || password.length < 8}
            className="w-full py-2 px-4 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:bg-slate-700 disabled:cursor-not-allowed disabled:text-slate-500"
          >
            {isSubmitting ? "Creating Account..." : "Create Account"}
          </button>
        </form>

        <div id="clerk-captcha" />
      </div>
    </div>
  );
}