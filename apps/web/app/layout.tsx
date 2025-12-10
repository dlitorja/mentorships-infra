import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { Toaster } from "sonner";
import { Header } from "@/components/navigation/header";
import { HeaderErrorBoundary } from "@/components/navigation/header-error-boundary";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Huckleberry Art Mentorships | 1-on-1 & Group Art Mentorship",
  description:
    "Connect with world-class art instructors from gaming, TV, film, and independent studios. Personalized 1-on-1 and group mentorship experiences to help you achieve your artistic goals.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Use environment variable or fallback for build-time static generation
  // The fallback allows the build to complete even if env var is not set during build
  // In production, the env var should always be set in Vercel environment variables
  const clerkPublishableKey = 
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || 
    "pk_test_placeholder_for_build_time_only";

  return (
    <ClerkProvider
      // Reduce verbose debug logging in development
      // The 422 error is typically a validation error (e.g., email already exists)
      // and is handled gracefully by Clerk's UI
      publishableKey={clerkPublishableKey}
    >
      <html lang="en">
        <body className={`${inter.className} antialiased`}>
          <HeaderErrorBoundary>
            <Header />
          </HeaderErrorBoundary>
          {children}
          <Toaster />
        </body>
      </html>
    </ClerkProvider>
  );
}

