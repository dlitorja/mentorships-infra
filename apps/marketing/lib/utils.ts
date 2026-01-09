import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export interface RedisLike {
  incr(key: string): Promise<number>;
  ttl(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<void>;
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

export async function rateLimit(
  key: string,
  maxRequests: number = 10,
  windowMs: number = 60000,
  redisClient?: RedisLike
): Promise<RateLimitResult> {
  const useRedis = redisClient && typeof redisClient.incr === "function" && typeof redisClient.expire === "function";

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

export function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
