import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { fetchAction } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { LayoutClient } from "@/components/layout-client";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Huckleberry Drive",
  description: "Instructor file management portal",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): Promise<React.ReactElement> {
  const { userId, getToken } = await auth();

  if (!userId) {
    return (
      <ClerkProvider
        signInUrl="/sign-in"
        signUpUrl="/sign-up"
      >
        <html lang="en">
          <body
            className={`${geistSans.variable} ${geistMono.variable} antialiased`}
          >
            {children}
          </body>
        </html>
      </ClerkProvider>
    );
  }

  let userRole: "instructor" | "admin" | "video_editor" | null = null;
  let userName: string | undefined;
  let layoutError: string | null = null;

  try {
    const token = await getToken({ template: "convex" });
    if (!token) {
      throw new Error("Clerk returned no Convex token — check the 'convex' JWT template exists for this Clerk instance.");
    }
    const dbUser = await fetchAction(api.users.getUserByClerkIdServer, { userId }, { token });

    const rawRole = dbUser?.role;
    userRole =
      rawRole === "instructor" || rawRole === "admin" || rawRole === "video_editor"
        ? rawRole
        : null;
    userName = dbUser?.email;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[layout] Failed to resolve user role:", message);
    layoutError = message;
  }

  return (
    <ClerkProvider
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
    >
      <html lang="en">
        <body
          className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        >
          {layoutError && (
            <div className="fixed top-0 left-0 right-0 z-50 bg-red-900/90 text-red-100 px-4 py-2 text-sm font-medium">
              Layout auth error: {layoutError}
            </div>
          )}
          <LayoutClient userRole={userRole} userName={userName}>
            {children}
          </LayoutClient>
        </body>
      </html>
    </ClerkProvider>
  );
}