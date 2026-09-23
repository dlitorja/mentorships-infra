"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { convexQuery, useConvexAction, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";

export type DigestSettings = {
  enabled: boolean;
  frequency: "daily" | "weekly" | "monthly";
  adminEmail: string;
  lastSentAt: number | null;
  updatedAt: number | null;
};

/**
 * PR 7: hook layer for the marketing /admin/digest page.
 *
 * Replaces three Supabase-backed `fetch('/api/admin/digest-*')` calls
 * (digest-settings GET/PUT, digest-send POST) with three Convex hooks.
 * Spec in `docs/plans/marketing-convex-admin-mirror.md` §4f.
 *
 * The shape matches the `digestSettingsSchema` in
 * `components/admin/digest-settings-form.tsx` exactly so the form's
 * state object stays unchanged (the old Zod parsing is now redundant
 * because Convex validates server-side, but the field names are the
 * same so the JSX does not need to change).
 */

/**
 * Reads the singleton digest settings row. Returns the canonical
 * defaults if no row exists yet (Convex query returns
 * `DEFAULT_SETTINGS` in that case — see `convex/digest.ts`).
 */
export function useDigestSettings() {
  return useQuery({
    ...convexQuery(api.digest.getAdminDigestSettings, {}),
  });
}

/**
 * Upserts the singleton digest settings row. The mutation returns
 * the new row so the caller can refresh local state without an
 * extra round-trip.
 *
 * Invalidates `["convexQuery", "digest:getAdminDigestSettings"]`
 * on success so the next `useDigestSettings` read pulls the freshly-
 * persisted value.
 */
export function useUpdateDigestSettings() {
  return useMutation({
    mutationFn: useConvexMutation(api.digest.upsertAdminDigestSettings),
  });
}

/**
 * Sends a manual digest email. Wraps the Convex action
 * `api.digestActions.sendAdminDigestEmail`, which reads settings +
 * report data, sends via Resend, and updates `lastSentAt` on
 * success. The action returns the same shape the old Supabase POST
 * route did (`{ success, message, recipientEmail, periodStart,
 * periodEnd, newSignups, emailsSent, conversions, emailId }`) so
 * the form's toast string stays unchanged.
 */
export function useSendDigest() {
  return useMutation({
    mutationFn: useConvexAction(api.digestActions.sendAdminDigestEmail),
  });
}
