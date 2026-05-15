import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): React.ReactElement {
  const clerkJSVersion = "5" as const;
  const clerkJSUrl = `https://cdn.jsdelivr.net/npm/@clerk/clerk-js@${clerkJSVersion}/dist/clerk.browser.js` as const;
  const clerkUIVersion = "1" as const;
  const clerkUIUrl = `https://cdn.jsdelivr.net/npm/@clerk/ui@${clerkUIVersion}/dist/ui.browser.js` as const;

  return (
    <ClerkProvider clerkJSVersion={clerkJSVersion} clerkJSUrl={clerkJSUrl} clerkUIVersion={clerkUIVersion} clerkUIUrl={clerkUIUrl}>
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
