import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { fetchAction } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { redirect } from "next/navigation";
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
        afterSignInUrl="/dashboard"
        afterSignUpUrl="/dashboard"
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

  const token = await getToken({ template: "convex" }) ?? undefined;
  const dbUser = await fetchAction(api.users.getUserByClerkIdServer, { userId }, { token });

  if (!dbUser) {
    redirect("/sign-in");
  }

  const userRole = dbUser.role as "student" | "instructor" | "admin" | "video_editor";
  const userName = dbUser.email;

  return (
    <ClerkProvider
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      afterSignInUrl="/dashboard"
      afterSignUpUrl="/dashboard"
    >
      <html lang="en">
        <body
          className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        >
          <LayoutClient userRole={userRole} userName={userName}>
            {children}
          </LayoutClient>
        </body>
      </html>
    </ClerkProvider>
  );
}