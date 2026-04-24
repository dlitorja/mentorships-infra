import { ConvexReactClient } from "convex/react";
import { ConvexQueryClient } from "@convex-dev/react-query";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

export const convexClient = convexUrl
  ? new ConvexReactClient(convexUrl)
  : null;

export const convexQueryClient = convexUrl
  ? new ConvexQueryClient(convexUrl)
  : null;