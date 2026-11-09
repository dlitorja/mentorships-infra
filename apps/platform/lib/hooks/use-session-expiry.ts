"use client";

import { useSession } from "@clerk/nextjs";

import { willSessionExpireDuringCall } from "@/lib/video/session-expiry";

export type SessionExpiryStatus = {
  /** False until Clerk has resolved the current session. */
  isLoaded: boolean;
  /** Clerk session maximum-lifetime expiry, or null when signed out. */
  expiresAt: Date | null;
  /**
   * True when the current session will reach its maximum lifetime before
   * a call could end. See `willSessionExpireDuringCall`.
   */
  expiresDuringCall: boolean;
};

/**
 * Reads the current Clerk session's `expireAt` so the call surfaces can
 * prompt for re-authentication BEFORE a call starts instead of letting
 * Clerk's max session lifetime end the session mid-call.
 *
 * This is a client-only read (no Clerk configuration is changed). On the
 * current plan the maximum lifetime is fixed at 7 days and cannot be
 * extended by activity, so a per-call prompt is the durable app-side
 * mitigation.
 */
export function useSessionExpiry(): SessionExpiryStatus {
  const { isLoaded, session } = useSession();
  const expiresAt = session?.expireAt ?? null;

  return {
    isLoaded,
    expiresAt,
    expiresDuringCall: willSessionExpireDuringCall(expiresAt),
  };
}
