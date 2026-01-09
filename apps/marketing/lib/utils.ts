import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Fisher-Yates shuffle algorithm to randomize array
 * @param array - Array to shuffle
 * @returns New shuffled array (original array is not modified)
 */
export function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export interface RateLimitResult {
  success: boolean;
  resetAt?: Date;
}

const rateLimitMap = new Map<string, { count: number; resetAt: Date }>();

function cleanupExpiredEntries(): void {
  const now = new Date();
  for (const [key, record] of rateLimitMap.entries()) {
    if (record.resetAt < now) {
      rateLimitMap.delete(key);
    }
  }
}

let cleanupInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Rate limiting utility for API requests
 *
 * Tracks requests per key using an in-memory Map, increments counts,
 * resets after windowMs, and returns a RateLimitResult indicating success and
 * optional resetAt.
 *
 * @param key - Unique identifier for the rate limit (e.g., user ID or IP)
 * @param maxRequests - Maximum number of requests allowed in the time window (default: 10)
 * @param windowMs - Time window in milliseconds (default: 60000 = 1 minute)
 * @returns RateLimitResult with success status and optional resetAt timestamp
 *
 * @sideEffects - Mutates rateLimitMap with tracking data
 * @sideEffects - Starts a periodic cleanup interval to remove expired entries
 */
export function rateLimit(
  key: string,
  maxRequests: number = 10,
  windowMs: number = 60000
): RateLimitResult {
  if (!cleanupInterval) {
    const cleanupIntervalMs = Math.min(windowMs, 60000);
    cleanupInterval = setInterval(cleanupExpiredEntries, cleanupIntervalMs);
  }

  if (typeof process !== "undefined" && process.on) {
    process.on("beforeExit", () => {
      if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
      }
    });
  }

  const now = new Date();
  const record = rateLimitMap.get(key);

  if (!record || record.resetAt < now) {
    rateLimitMap.set(key, {
      count: 1,
      resetAt: new Date(now.getTime() + windowMs),
    });
    return { success: true };
  }

  if (record.count >= maxRequests) {
    return { success: false, resetAt: record.resetAt };
  }

  record.count++;
  return { success: true };
}
  return shuffled;
}

interface RateLimitResult {
  success: boolean;
  resetAt?: Date;
}

const rateLimitMap = new Map<string, { count: number; resetAt: Date }>();

function cleanupExpiredEntries(): void {
  const now = new Date();
  for (const [key, record] of rateLimitMap.entries()) {
    if (record.resetAt < now) {
      rateLimitMap.delete(key);
    }
  }
}

const cleanupInterval = setInterval(cleanupExpiredEntries, 60000);

if (typeof process !== "undefined" && process.on) {
  process.on("beforeExit", () => clearInterval(cleanupInterval));
}

export function rateLimit(
  key: string,
  maxRequests: number = 10,
  windowMs: number = 60000
): RateLimitResult {
  const now = new Date();
  const record = rateLimitMap.get(key);

  if (!record || record.resetAt < now) {
    rateLimitMap.set(key, {
      count: 1,
      resetAt: new Date(now.getTime() + windowMs),
    });
    return { success: true };
  }

  if (record.count >= maxRequests) {
    return { success: false, resetAt: record.resetAt };
  }

  record.count++;
  return { success: true };
}
