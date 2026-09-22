"use client";

import { useConvex } from "convex/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/convex/_generated/api";

export type AddToWaitlistVariables = {
  email: string;
  instructorSlug: string;
  mentorshipType: "oneOnOne" | "group";
  turnstileToken?: string;
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
 * `useConvex()` calls `useContext(ConvexContext)`; the context
 * default is `undefined`, so the hook returns `undefined` (not
 * throws) when no `ConvexProvider` is above. The marketing
 * `<ConvexClientProvider>` returns a bare fragment in the
 * `skipClerk` build branch, so during static generation
 * `useConvex()` returns `undefined` here and the `if (!convex)`
 * guard short-circuits the mutation at runtime. We additionally
 * wrap `useConvex()` in a defensive try/catch so that if a
 * future convex-react release ever changes `useConvex()` to throw
 * in the no-provider case, this hook still degrades to a runtime
 * error instead of crashing the static build. Verified locally:
 * `pnpm build` with `NEXT_PUBLIC_CONVEX_URL=""` produces a
 * successful static export of `/instructors/[slug]` and
 * `/instructors/[slug]/courses`.
 */
export function useAddToWaitlist() {
  const queryClient = useQueryClient();
  let convex: ReturnType<typeof useConvex> | undefined;
  try {
    convex = useConvex();
  } catch {
    convex = undefined;
  }

  return useMutation<AddToWaitlistResult, Error, AddToWaitlistVariables>({
    mutationFn: async (variables) => {
      if (!convex) {
        throw new Error(
          "useAddToWaitlist invoked without a Convex client. The provider tree should mount <ConvexClientProvider> at the marketing app root."
        );
      }
      if (variables.turnstileToken) {
        return await convex.action(api.waitlist.actionAddToWaitlist, variables);
      }
      return await convex.mutation(api.waitlist.addToWaitlist, {
        email: variables.email,
        instructorSlug: variables.instructorSlug,
        mentorshipType: variables.mentorshipType,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["waitlist"] });
    },
  });
}
