import type { Metadata } from "next";
import { Inter } from "next/font/google";

export const dynamic = "force-dynamic";
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

  // Restore May 11–13 behavior: allow optional domainUrl; do not override script URL/version
  const domainUrl = process.env.NEXT_PUBLIC_CLERK_DOMAIN_URL || undefined;

  const isBuildTime = !clerkPublishableKey || clerkPublishableKey === BUILD_TIME_PLACEHOLDER_KEY;

  if (isBuildTime) {
    return (
      <html lang="en" className="bg-background dark">
        <body className={`${inter.className} antialiased bg-background text-foreground`}>
          <QueryProvider>
            <ConvexClientProvider skipClerk={true}>
              <HeaderErrorBoundary>
                <Header hasClerk={hasValidClerkKey} />
              </HeaderErrorBoundary>
              {children}
              <Toaster />
            </ConvexClientProvider>
          </QueryProvider>
        </body>
      </html>
    );
  }

  return (
    <html lang="en" className="bg-background dark">
      <body className={`${inter.className} antialiased bg-background text-foreground`}>
        <ClerkProvider
          publishableKey={clerkPublishableKey}
          {...(domainUrl && { domainUrl })}
        >
          <QueryProvider>
            <ConvexClientProvider>
              <HeaderErrorBoundary>
                <Header hasClerk={hasValidClerkKey} />
              </HeaderErrorBoundary>
              {children}
              <Toaster />
            </ConvexClientProvider>
          </QueryProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
