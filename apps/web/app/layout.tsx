import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { Toaster } from "sonner";
import { Header } from "@/components/navigation/header";
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
  const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  
  // If Clerk key is not available, render without ClerkProvider
  // This can happen during build if env vars aren't set
  if (!clerkKey) {
    return (
      <html lang="en">
        <body className={`${inter.className} antialiased`}>
          <Header />
          {children}
          <Toaster />
        </body>
      </html>
    );
  }

  return (
    <ClerkProvider
      // Reduce verbose debug logging in development
      // The 422 error is typically a validation error (e.g., email already exists)
      // and is handled gracefully by Clerk's UI
      publishableKey={clerkKey}
    >
      <html lang="en">
        <body className={`${inter.className} antialiased`}>
          <Header />
          {children}
          <Toaster />
        </body>
      </html>
    </ClerkProvider>
  );
}

