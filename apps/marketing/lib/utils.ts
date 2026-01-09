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
