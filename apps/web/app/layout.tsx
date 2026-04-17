import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { Toaster } from "sonner";
import { Header } from "@/components/navigation/header";
import { HeaderErrorBoundary } from "@/components/navigation/header-error-boundary";
import { QueryProvider } from "@/lib/providers/query-provider";
import ConvexClientProvider from "@/components/convex-client-provider";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

// Placeholder key used for build-time only (excluded from validation)
const BUILD_TIME_PLACEHOLDER_KEY = "pk_test_placeholder_for_build_time_only";

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
  const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const hasValidClerkKey = Boolean(
    clerkPublishableKey && 
    clerkPublishableKey !== BUILD_TIME_PLACEHOLDER_KEY &&
    clerkPublishableKey.startsWith("pk_")
  );

  // Get domain URL for Clerk (helps with network requests)
  // Only set if explicitly configured via environment variable
  // Clerk will auto-detect the domain in the browser
  const domainUrl = process.env.NEXT_PUBLIC_CLERK_DOMAIN_URL || undefined;

  const layoutContent = (
    <html lang="en">
      <body className={`${inter.className} antialiased`}>
        <HeaderErrorBoundary>
          <Header hasClerk={hasValidClerkKey} />
        </HeaderErrorBoundary>
        {children}
        <Toaster />
      </body>
    </html>
  );

  // Use placeholder during build without valid key to avoid ClerkProvider errors
  const isBuildTime = !clerkPublishableKey || clerkPublishableKey === BUILD_TIME_PLACEHOLDER_KEY;
  
  if (isBuildTime) {
    return (
      <QueryProvider>
        <ConvexClientProvider skipClerk={true}>
          {layoutContent}
        </ConvexClientProvider>
      </QueryProvider>
    );
  }
  
  return (
    <ClerkProvider
      publishableKey={clerkPublishableKey}
      {...(domainUrl && { domainUrl })}
    >
      <QueryProvider>
        <ConvexClientProvider>
          {layoutContent}
        </ConvexClientProvider>
      </QueryProvider>
    </ClerkProvider>
  );
}

