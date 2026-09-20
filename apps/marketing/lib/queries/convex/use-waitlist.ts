"use client";

import { useConvex } from "convex/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/convex/_generated/api";

export type AddToWaitlistVariables = {
  email: string;
  instructorSlug: string;
  mentorshipType: "oneOnOne" | "group";
};

export type AddToWaitlistResult = {
  success: boolean;
  message: string;
  existingId?: string;
  id?: string;
};

/**
 * PR 6a: client-side hook for the student-facing waitlist write
 * path. Mirrors `apps/platform/lib/queries/convex/use-waitlist.ts:7`
 * with one important difference for the marketing app's static-
 * generation build path.
 *
 * The marketing app's root layout (`app/layout.tsx:34`) renders
 * `<ConvexClientProvider skipClerk>` during build when no Clerk
 * key is set, which skips the Convex provider entirely. The
 * instructor slug pages (`app/instructors/[slug]/page.tsx`) are
 * statically generated, so the build-time render of
 * `<OfferButton>` reaches this hook without a Convex client in
 * scope. The naive `useConvexMutation(api.waitlist.addToWaitlist)`
 * pattern throws on that render path.
 *
 * We gate on `useConvex()` (returns `undefined` when no
 * `ConvexProvider` is above) and fall through to a stub mutation
 * that throws only when `mutate` is actually invoked. This keeps
 * the build green and degrades to a runtime error if the hook is
 * ever called outside a provider for real (which would already be
 * a configuration bug).
 */
export function useAddToWaitlist() {
  const queryClient = useQueryClient();
  const convex = useConvex();

  return useMutation<AddToWaitlistResult, Error, AddToWaitlistVariables>({
    mutationFn: async (variables) => {
      if (!convex) {
        throw new Error(
          "useAddToWaitlist invoked without a Convex client. The provider tree should mount <ConvexClientProvider> at the marketing app root."
        );
      }
      return await convex.mutation(api.waitlist.addToWaitlist, variables);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["waitlist"] });
    },
  });
}
