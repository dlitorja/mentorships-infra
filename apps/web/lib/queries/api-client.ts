/**
 * API client utilities for TanStack Query
 * 
 * Provides type-safe fetch wrappers with error handling.
 * Use these functions as queryFn in useQuery/useMutation.
 */

import { z } from "zod";

/**
 * Type-safe fetch wrapper that handles errors and JSON parsing
 */
async function apiFetch<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      error: `HTTP ${response.status}: ${response.statusText}`,
    }));
    throw new Error(error.error || `Request failed: ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

/**
 * Fetch a product by ID
 */
export async function fetchProduct(id: string) {
  return apiFetch<{
    id: string;
    title: string;
    price: string;
    sessionsPerPack: number;
    validityDays: number;
    stripePriceId: string | null;
    mentor: {
      id: string;
      userId: string;
    };
  }>(`/api/products/${id}`);
}

/**
 * Fetch all active products for checkout
 */
export async function fetchProducts() {
  return apiFetch<{
    items: Array<{
      id: string;
      title: string;
      price: string;
      sessionsPerPack: number;
      validityDays: number;
      stripePriceId: string | null;
      paypalProductId: string | null;
      mentorId: string;
    }>;
  }>("/api/products");
}

/**
 * Fetch user's session packs
 */
export async function fetchMySessionPacks() {
  return apiFetch<{
    items: Array<{
      id: string;
      remainingSessions: number;
      expiresAt: Date;
      mentor: {
        id: string;
        userId: string;
      };
    }>;
  }>("/api/session-packs/me");
}

/**
 * Get waitlist status for current user
 */
export async function fetchWaitlistStatus(instructorSlug?: string) {
  const params = instructorSlug
    ? `?instructorSlug=${encodeURIComponent(instructorSlug)}`
    : "";
  return apiFetch<{
    onWaitlist: boolean;
    entries: Array<{
      id: string;
      instructorSlug: string;
      type: string;
      createdAt: string;
    }>;
  }>(`/api/waitlist${params}`);
}

/**
 * Join waitlist
 */
export async function joinWaitlist(data: {
  email: string;
  instructorSlug?: string;
  type?: string;
}) {
  return apiFetch<{ success: boolean; message?: string }>("/api/waitlist", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Create Stripe checkout session
 */
export async function createCheckoutSession(data: { packId: string } | { productId: string }) {
  return apiFetch<{ url: string; orderId: string; checkoutUrl?: string }>("/api/checkout/stripe", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Create PayPal checkout session
 */
export async function createPayPalCheckoutSession(data: { packId: string }) {
  return apiFetch<{ orderId: string; url: string }>("/api/checkout/paypal", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Verify checkout session
 */
export async function verifyCheckoutSession(sessionId: string) {
  return apiFetch<{ verified: boolean }>(`/api/checkout/verify?session_id=${sessionId}`);
}

/**
 * Get mentor availability
 */
export async function fetchMentorAvailability(
  mentorId: string,
  start: string,
  end: string,
  slotMinutes: number = 60
) {
  const response = await fetch(
    `/api/mentors/${mentorId}/availability?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&slotMinutes=${slotMinutes}`
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      error: `HTTP ${response.status}: ${response.statusText}`,
    }));
    
    // Preserve error code for special handling (e.g., GOOGLE_CALENDAR_NOT_CONNECTED)
    const errorMessage = error.error || `Request failed: ${response.statusText}`;
    const errorWithCode = new Error(errorMessage);
    if (error.code) {
      (errorWithCode as Error & { code?: string }).code = error.code;
    }
    throw errorWithCode;
  }

  const data = await response.json();
  return {
    availableSlots: data.availableSlots ?? [],
    truncated: data.truncated ?? false,
  };
}

/**
 * Book a session
 */
export async function bookSession(data: { sessionPackId: string; scheduledAt: string }) {
  return apiFetch<{ success: boolean; sessionId?: string }>("/api/sessions", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Update instructor settings
 */
export async function updateInstructorSettings(data: {
  timeZone: string | null;
  workingHours: Record<string, Array<{ start: string; end: string }>>;
}) {
  return apiFetch<{ success: boolean }>("/api/instructor/settings", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

/**
 * Upload onboarding images
 */
export async function uploadOnboardingImages(formData: FormData) {
  const response = await fetch("/api/onboarding/uploads", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      error: `HTTP ${response.status}: ${response.statusText}`,
    }));
    throw new Error(error.error || `Request failed: ${response.statusText}`);
  }

  return response.json() as Promise<{
    success: true;
    submissionId: string;
    images: Array<{ path: string; mimeType: string; sizeBytes: number }>;
  }>;
}

/**
 * Submit onboarding
 */
export async function submitOnboarding(data: {
  submissionId: string;
  sessionPackId: string;
  goals: string;
  imageObjects: Array<{ path: string; mimeType: string; sizeBytes: number }>;
}) {
  return apiFetch<{ success: boolean }>("/api/onboarding/submit", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Submit contact form
 */
export async function submitContact(data: { email: string; artGoals: string }) {
  return apiFetch<{ success: boolean }>("/api/contacts", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Create product from Stripe
 */
export async function createProductFromStripe(data: {
  productId?: string;
  priceId?: string;
  mentorId?: string;
}) {
  return apiFetch<{
    success: boolean;
    message: string;
    product?: {
      id: string;
      title: string;
      price: string;
      stripePriceId: string;
    };
  }>("/api/products/create-from-stripe", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export type MentorshipType = "one-on-one" | "group";

/**
 * Create a new product with full fields
 */
export async function createProduct(data: {
  mentorId: string;
  title: string;
  description?: string;
  imageUrl?: string;
  price: string;
  currency?: string;
  sessionsPerPack: number;
  validityDays: number;
  mentorshipType: MentorshipType;
  enableStripe: boolean;
  enablePayPal: boolean;
}) {
  return apiFetch<{
    success: boolean;
    message: string;
    product: {
      id: string;
      title: string;
      price: string;
      currency: string;
      sessionsPerPack: number;
      validityDays: number;
      mentorshipType: string;
      stripe: {
        productId: string;
        productLink: string;
        priceId: string;
        priceLink: string;
      } | null;
      paypal: {
        productId: string;
        productLink: string;
      } | null;
    };
  }>("/api/admin/products", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

const MentorSchema = z.object({
  id: z.string(),
  userId: z.string(),
  email: z.string().nullable(),
  maxActiveStudents: z.number(),
  oneOnOneInventory: z.number(),
  groupInventory: z.number(),
  createdAt: z.string().nullable(),
});

const FetchMentorsResponseSchema = z.object({
  items: z.array(MentorSchema),
});

type FetchMentorsResponse = z.infer<typeof FetchMentorsResponseSchema>;

/**
 * Fetch all mentors for admin
 */
export async function fetchMentors(): Promise<FetchMentorsResponse> {
  const data = await apiFetch<unknown>("/api/admin/mentors");
  return FetchMentorsResponseSchema.parse(data);
}

/**
 * Update an existing product
 */
export async function updateProduct(
  id: string,
  data: {
    mentorId?: string;
    title: string;
    description?: string;
    imageUrl?: string;
    price: string;
    currency?: string;
    sessionsPerPack: number;
    validityDays: number;
    mentorshipType?: "one-on-one" | "group";
    enableStripe: boolean;
    enablePayPal: boolean;
    deactivateOldPrice?: boolean;
  }
) {
  const response = await apiFetch<unknown>("/api/admin/products/" + id, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  return UpdateProductResponseSchema.parse(response);
}

const UpdateProductResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  product: z.object({
    id: z.string(),
    mentorId: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    imageUrl: z.string().nullable(),
    price: z.string(),
    currency: z.string(),
    sessionsPerPack: z.number(),
    validityDays: z.number(),
    mentorshipType: z.string(),
    stripePriceId: z.string().nullable(),
    stripeProductId: z.string().nullable(),
    paypalProductId: z.string().nullable(),
    active: z.boolean(),
  }),
  changes: z
    .object({
      priceChanged: z.boolean(),
      newStripePriceId: z.string().nullable(),
      oldStripePriceId: z.string().nullable(),
    })
    .optional(),
});

type UpdateProductResponse = z.infer<typeof UpdateProductResponseSchema>;

/**
 * Get current user settings
 */
export async function getUserSettings() {
  return apiFetch<{
    userId: string;
    email: string;
    timeZone: string | null;
    discordConnected: boolean;
  }>("/api/user/settings");
}

/**
 * Update user timezone
 */
export async function updateUserTimeZoneSetting(timeZone: string) {
  return apiFetch<{ success: boolean; timeZone: string }>("/api/user/settings", {
    method: "PATCH",
    body: JSON.stringify({ timeZone }),
  });
}
