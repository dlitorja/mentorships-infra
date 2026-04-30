import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { Toaster } from "sonner";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

const BUILD_TIME_PLACEHOLDER_KEY = "pk_test_placeholder_for_build_time_only";

export const metadata: Metadata = {
  title: "Huckleberry Art | Learn from Industry Pros",
  description:
    "1-on-1 mentorships with working professionals from gaming, TV, and film. Get personalized guidance to build the skills and portfolio you need.",
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

  const domainUrl = process.env.NEXT_PUBLIC_CLERK_DOMAIN_URL || undefined;

  const layoutContent = (
    <html lang="en" className="dark">
      <body className={`${inter.className} antialiased bg-background text-foreground`}>
        {children}
        <Toaster />
      </body>
    </html>
  );

  const isBuildTime = !clerkPublishableKey || clerkPublishableKey === BUILD_TIME_PLACEHOLDER_KEY;

  if (isBuildTime) {
    return layoutContent;
  }

  return (
    <ClerkProvider
      publishableKey={clerkPublishableKey}
      {...(domainUrl && { domainUrl })}
    >
      {layoutContent}
    </ClerkProvider>
  );
}