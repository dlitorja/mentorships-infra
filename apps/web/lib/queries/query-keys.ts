/**
 * Query key factories for TanStack Query
 * 
 * Centralized query keys ensure consistency and type safety.
 * Use these factories to create query keys for all queries.
 * 
 * @example
 * ```ts
 * const { data } = useQuery({
 *   queryKey: queryKeys.products.detail(productId),
 *   queryFn: () => fetchProduct(productId),
 * });
 * ```
 */
export const queryKeys = {
  /**
   * Product-related query keys
   */
  products: {
    all: ["products"] as const,
    detail: (id: string) => ["products", "detail", id] as const,
    byStripePrice: (stripePriceId: string) =>
      ["products", "by-stripe-price", stripePriceId] as const,
  },

  /**
   * Session pack-related query keys
   */
  sessionPacks: {
    all: ["session-packs"] as const,
    my: ["session-packs", "my"] as const,
    detail: (id: string) => ["session-packs", "detail", id] as const,
  },

  /**
   * Waitlist-related query keys
   */
  waitlist: {
    all: ["waitlist"] as const,
    status: (instructorSlug?: string) =>
      ["waitlist", "status", instructorSlug] as const,
  },

  /**
   * Session-related query keys
   */
  sessions: {
    all: ["sessions"] as const,
    upcoming: (limit?: number) => ["sessions", "upcoming", limit] as const,
    recent: (limit?: number) => ["sessions", "recent", limit] as const,
    detail: (id: string) => ["sessions", "detail", id] as const,
  },

  /**
   * Checkout-related query keys
   */
  checkout: {
    verify: (sessionId: string) => ["checkout", "verify", sessionId] as const,
  },

  /**
   * Mentor availability query keys
   */
  mentors: {
    availability: (mentorId: string, start: string, end: string) =>
      ["mentors", mentorId, "availability", start, end] as const,
  },

  /**
   * Instructor settings query keys
   */
  instructor: {
    settings: ["instructor", "settings"] as const,
  },

  /**
   * Onboarding query keys
   */
  onboarding: {
    uploads: ["onboarding", "uploads"] as const,
  },
} as const;

