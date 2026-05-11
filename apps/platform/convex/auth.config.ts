import { clerkClient } from "@clerk/nextjs/server";
import { ConvexAuthConfiguration } from "convex-auth";

export default {
  client: clerkClient,
} satisfies ConvexAuthConfiguration;