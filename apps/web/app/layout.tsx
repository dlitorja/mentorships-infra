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
  const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";
  
  // Get domain URL for Clerk (helps with network requests)
  // Only set if explicitly configured via environment variable
  // Clerk will auto-detect the domain in the browser
  const domainUrl = process.env.NEXT_PUBLIC_CLERK_DOMAIN_URL || undefined;
  
  return (
    <ClerkProvider
      publishableKey={clerkKey}
      {...(domainUrl && { domainUrl })}
      // Reduce verbose debug logging in development
      // The 422 error is typically a validation error (e.g., email already exists)
      // and is handled gracefully by Clerk's UI
      // Network errors are usually temporary and will retry automatically
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

