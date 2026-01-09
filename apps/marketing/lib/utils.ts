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
let cleanupListenerRegistered = false;

/**
 * Rate limiting utility for API requests
 *
 * Tracks requests per key using an in-memory Map, increments counts,
 * resets after windowMs, and returns a RateLimitResult indicating success and
 * optional resetAt.
 *
 * @param key - Unique identifier for rate limit (e.g., user ID or IP)
 * @param maxRequests - Maximum number of requests allowed in time window (default: 10)
 * @param windowMs - Time window in milliseconds (default: 60000 = 1 minute)
 * @returns RateLimitResult with success status and optional resetAt timestamp
 *
 * @sideEffects - Mutates rateLimitMap with tracking data
 * @sideEffects - Starts a periodic cleanup interval to remove expired entries
 * @param redisClient - Optional Redis client for distributed rate limiting (default: undefined)
 */
export async function rateLimit(
  key: string,
  maxRequests: number = 10,
  windowMs: number = 60000,
  redisClient?: any
): Promise<RateLimitResult> {
  const useRedis = redisClient && typeof redisClient.set === "function" && typeof redisClient.expire === "function";

  if (useRedis) {
    const redisKey = `rate_limit:${key}`;
    const result = await redisClient.incr(redisKey);
    
    if (result === 1) {
      await redisClient.expire(redisKey, Math.ceil(windowMs / 1000));
      return { success: true };
    }
    
    const ttl = await redisClient.ttl(redisKey);
    const currentCount = result - 1;
    
    if (ttl === -1) {
      await redisClient.expire(redisKey, Math.ceil(windowMs / 1000));
    }
    
    if (currentCount >= maxRequests) {
      return { success: false, resetAt: new Date(Date.now() + windowMs) };
    }
    
    return { success: true };
  }

  if (!cleanupInterval) {
    const cleanupIntervalMs = Math.min(windowMs, 60000);
    cleanupInterval = setInterval(cleanupExpiredEntries, cleanupIntervalMs);
  }

  if (!cleanupListenerRegistered && typeof process !== "undefined" && process.on) {
    process.on("beforeExit", () => {
      if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
      }
    });
    cleanupListenerRegistered = true;
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
let cleanupListenerRegistered = false;

/**
 * Rate limiting utility for API requests
 *
 * Tracks requests per key using an in-memory Map, increments counts,
 * resets after windowMs, and returns a RateLimitResult indicating success and
 * optional resetAt.
 *
 * @param key - Unique identifier for rate limit (e.g., user ID or IP)
 * @param maxRequests - Maximum number of requests allowed in time window (default: 10)
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

  if (!cleanupListenerRegistered && typeof process !== "undefined" && process.on) {
    process.on("beforeExit", () => {
      if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
      }
    });
    cleanupListenerRegistered = true;
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
