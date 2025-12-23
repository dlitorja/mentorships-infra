/**
 * API client utilities for TanStack Query
 * 
 * Provides type-safe fetch wrappers with error handling.
 * Use these functions as queryFn in useQuery/useMutation.
 */

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

