import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";

import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

    const dbUser = await convex.query(api.users.getUserByClerkIdPublic, { userId });
    if (dbUser) {
      userRole = dbUser.role as typeof userRole;
