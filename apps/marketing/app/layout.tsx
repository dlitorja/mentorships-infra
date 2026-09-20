import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { Toaster } from "sonner";
import { QueryProvider } from "@/lib/providers/query-provider";
import ConvexClientProvider from "@/components/convex-client-provider";

import { Header } from "@/components/navigation/header";
import { Footer } from "@/components/navigation/footer";

import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

// Placeholder key used for build-time only (excluded from validation)
const BUILD_TIME_PLACEHOLDER_KEY = "pk_test_placeholder_for_build_time_only";

export const metadata: Metadata = {
  title: "Huckleberry Art Mentorships | 1-on-1 & Group Art Mentorship",
  description:
    "Connect with world-class art instructors from gaming, TV, film, and independent studios. Personalized 1-on-1 and group mentorship experiences.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): React.JSX.Element {
  const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const domainUrl = process.env.NEXT_PUBLIC_CLERK_DOMAIN_URL || undefined;

  const isBuildTime = !clerkPublishableKey || clerkPublishableKey === BUILD_TIME_PLACEHOLDER_KEY;

  if (isBuildTime) {
    return (
      <html lang="en" className="bg-background dark">
        <body className={`${inter.className} antialiased bg-background text-foreground`}>
          <ConvexClientProvider skipClerk>
            <QueryProvider>
              <Header />
              {children}
              <Footer />
              <Toaster position="top-right" duration={4000} richColors />
            </QueryProvider>
          </ConvexClientProvider>
        </body>
      </html>
    );
  }

  return (
    <ClerkProvider
      publishableKey={clerkPublishableKey}
      {...(domainUrl && { domainUrl })}
    >
      <html lang="en" className="bg-background dark">
        <body className={`${inter.className} antialiased bg-background text-foreground`}>
          <ConvexClientProvider>
            <QueryProvider>
              <Header />
              {children}
              <Footer />
              <Toaster position="top-right" duration={4000} richColors />
            </QueryProvider>
          </ConvexClientProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
