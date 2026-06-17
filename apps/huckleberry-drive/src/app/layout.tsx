import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { getUserById } from "@mentorships/db";
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
  const { userId } = await auth();
  let userRole: "student" | "instructor" | "admin" | "video_editor" = "student";
  let userName: string | undefined;

  if (userId) {
    const dbUser = await getUserById(userId);
    if (dbUser) {
      userRole = dbUser.role;
      userName = dbUser.email;
    }
  }

  return (
    <ClerkProvider>
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