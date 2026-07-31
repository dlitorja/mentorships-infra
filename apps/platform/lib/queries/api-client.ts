/**
 * API client utilities for TanStack Query
 * 
 * Provides type-safe fetch wrappers with error handling.
 * Use these functions as queryFn in useQuery/useMutation.
 */

import { z } from "zod";
import { ApiRoutes } from "../routes";

/**
 * Error thrown by apiFetch for non-OK responses. Includes the HTTP status
 * and parsed response body so callers can handle specific status codes.
 */
export class ApiFetchError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly data: unknown
  ) {
    super(message);
    this.name = "ApiFetchError";
  }
}

/**
 * Type-safe fetch wrapper that handles errors and JSON parsing
 */
export async function apiFetch<T>(
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
    throw new ApiFetchError(
      error.error || `Request failed: ${response.statusText}`,
      response.status,
      error
    );
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
    instructor: {
      id: string;
      userId: string;
    };
  }>(ApiRoutes.product(id));
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
      instructorId: string;
    }>;
  }>(ApiRoutes.products);
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
      instructor: {
        id: string;
        userId: string;
      };
    }>;
  }>(ApiRoutes.sessionPacksMe);
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
  }>(`${ApiRoutes.waitlist}${params}`);
}

/**
 * Join waitlist
 */
export async function joinWaitlist(data: {
  email: string;
  instructorSlug?: string;
  type?: string;
}) {
  return apiFetch<{ success: boolean; message?: string }>(ApiRoutes.waitlist, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Create Stripe checkout session
 */
export async function createCheckoutSession(
  data:
    | { packId: string; email?: string; fullName?: string; promotionCode?: string }
    | { productId: string; email?: string; fullName?: string; promotionCode?: string }
) {
  return apiFetch<{ url: string; orderId?: string; checkoutUrl?: string }>(ApiRoutes.checkoutStripe, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Create PayPal checkout session
 *
 * Supports both { packId } and { productId } shapes for compatibility with the route.
 * Optionally includes guest fields (email, fullName) when the viewer is not signed in.
 */
export async function createPayPalCheckoutSession(
  data:
    | { packId: string; email?: string; fullName?: string }
    | { productId: string; email?: string; fullName?: string }
) {
  return apiFetch<{ orderId: string; url: string }>(ApiRoutes.checkoutPayPal, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Verify checkout session
 */
export async function verifyCheckoutSession(sessionId: string) {
  return apiFetch<{ verified: boolean }>(`${ApiRoutes.checkoutVerify}?session_id=${sessionId}`);
}

/**
 * Get instructor availability
 */
export async function fetchInstructorAvailability(
  instructorId: string,
  start: string,
  end: string,
  slotMinutes: number = 60
) {
  const response = await fetch(
    `${ApiRoutes.instructorAvailability(instructorId)}?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&slotMinutes=${slotMinutes}`
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
 * Fetch a preview of available time slots for an instructor
 */
export async function fetchInstructorAvailabilityPreview(
  instructorId: string,
  slots: number = 3,
  days: number = 14
): Promise<{
  connected: boolean;
  instructorTimeZone?: string | null;
  slots: string[];
  message?: string;
}> {
  return apiFetch<any>(
    `${ApiRoutes.instructorAvailabilityPreview(instructorId)}?slots=${slots}&days=${days}`
  );
}

/**
 * Book a session
 */
export async function bookSession(data: { sessionPackId: string; scheduledAt: string }) {
  return apiFetch<{ success: boolean; sessionId?: string }>(ApiRoutes.sessions, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Create a booking from a selected calendar slot
 */
export async function createBooking(data: {
  instructorId: string;
  start: string;
  end: string;
  timezone: string;
  studentName: string;
  suppressNotifications?: boolean;
}) {
  return apiFetch<{ success: boolean; booking?: { _id?: string; id?: string }; error?: string }>(ApiRoutes.bookings, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Create a recurring weekly series of bookings
 */
export async function createBookingSeries(data: {
  instructorId: string;
  start: string;
  timezone: string;
  weeks: number;
  studentName: string;
}) {
  return apiFetch<{ success: boolean; created?: number; skipped?: number; error?: string }>(ApiRoutes.bookingsSeries, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Send a booking notification for a specific booking
 */
export async function notifyBooking(data: { bookingId: string }) {
  return apiFetch<{ success: boolean; error?: string }>(ApiRoutes.bookingsNotify, {
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
  bufferMinutesBetweenSessions?: number | null;
  minBookingLeadMinutes?: number | null;
  maxBookingAdvanceDays?: number | null;
  blockedDateRanges?: Array<{ start: string; end: string; label?: string }> | null;
}) {
  return apiFetch<{ success: boolean }>(ApiRoutes.instructorSettings, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

/**
 * Upload onboarding images
 */
export async function uploadOnboardingImages(formData: FormData) {
  const response = await fetch(ApiRoutes.onboardingUploads, {
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
    images: Array<{ path: string; storageId: string; mimeType: string; sizeBytes: number }>;
  }>;
}

/**
 * Submit onboarding
 */
export async function submitOnboarding(data: {
  submissionId: string;
  sessionPackId: string;
  goals: string;
  imageObjects: Array<{ path: string; storageId: string; mimeType: string; sizeBytes: number }>;
}) {
  return apiFetch<{ success: boolean }>(ApiRoutes.onboardingSubmit, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Submit contact form
 */
export async function submitContact(data: { email: string; artGoals: string }) {
  return apiFetch<{ success: boolean }>(ApiRoutes.contacts, {
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
  instructorId?: string;
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
  }>(ApiRoutes.productsCreateFromStripe, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export type MentorshipType = "one-on-one" | "group";

/**
 * Create a new product with full fields
 */
export async function createProduct(data: {
  instructorId: string;
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
  }>(ApiRoutes.adminProducts, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Update an existing product
 */
export async function updateProduct(
  id: string,
  data: {
    instructorId?: string;
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
  const response = await apiFetch<unknown>(ApiRoutes.adminProduct(id), {
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
    instructorId: z.string(),
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

/**
 * Get current user settings
 */
export async function getUserSettings() {
  return apiFetch<{
    userId: string;
    email: string;
    timeZone: string | null;
    discordConnected: boolean;
  }>(ApiRoutes.userSettings);
}

/**
 * Update user timezone
 */
export async function updateUserTimeZoneSetting(timeZone: string) {
  return apiFetch<{ success: boolean; timeZone: string }>(ApiRoutes.userSettings, {
    method: "PATCH",
    body: JSON.stringify({ timeZone }),
  });
}

/**
 * Update the authenticated instructor's profile.
 * Returns the raw response shape so callers can handle validationErrors.
 */
export async function updateInstructorProfile(data: {
  name: string;
  tagline: string | null;
  bio: string | null;
  specialties: string[];
  background: string[];
  profileImageUrl: string | null;
  profileImageUploadPath: string | null;
  portfolioImages: string[];
  socials: Record<string, string | undefined> | null;
}) {
  const response = await fetch(ApiRoutes.instructorProfile, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  const responseData = await response.json().catch(() => ({
    error: `HTTP ${response.status}: ${response.statusText}`,
  }));

  return { ok: response.ok, status: response.status, data: responseData as { success?: boolean; error?: string; validationErrors?: string[] } };
}

/**
 * Create a testimonial for the current instructor
 */
export async function createTestimonial(data: { name: string; text: string }) {
  return apiFetch<{ success: boolean; message?: string; testimonial?: { id: string; name: string; text: string; createdAt: string } }>(ApiRoutes.instructorTestimonials, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Delete a testimonial for the current instructor
 */
export async function deleteTestimonial(id: string) {
  return apiFetch<{ success: boolean; message?: string }>(ApiRoutes.instructorTestimonial(id), {
    method: "DELETE",
  });
}

/**
 * Create a student result for the current instructor
 */
export async function createStudentResult(data: {
  imageUrl: string;
  imageUploadPath?: string;
  studentName?: string;
}) {
  return apiFetch<{ success: boolean; message?: string; studentResult?: { id: string; imageUrl: string | null; imageUploadPath: string | null; studentName: string | null; createdAt: string } }>(ApiRoutes.instructorStudentResults, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Delete a student result for the current instructor
 */
export async function deleteStudentResult(id: string) {
  return apiFetch<{ success: boolean; message?: string }>(ApiRoutes.instructorStudentResult(id), {
    method: "DELETE",
  });
}

/**
 * Google Calendar
 */

export type Calendar = {
  id: string;
  summary: string;
  accessRole: string;
  primary: boolean;
};

export type CalendarsResponse = {
  connected: boolean;
  calendars: Calendar[];
  selected: {
    eventCalendarId: string;
    availabilityCalendarIds: string[];
  };
};

/**
 * List Google calendars for the current instructor
 */
export async function getGoogleCalendars() {
  const response = await fetch(ApiRoutes.googleCalendars);
  if (response.status === 409) {
    const data = await response.json().catch(() => ({ error: "Google Calendar not connected" }));
    throw new Error(data.error || "Google Calendar not connected");
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: `HTTP ${response.status}: ${response.statusText}` }));
    throw new Error(error.error || "Failed to load calendars");
  }
  return response.json() as Promise<CalendarsResponse>;
}

/**
 * Save Google Calendar selection
 */
export async function saveGoogleCalendarSelection(data: {
  eventCalendarId: string;
  availabilityCalendarIds: string[];
}) {
  return apiFetch<{ success: boolean }>(ApiRoutes.googleCalendarsSelect, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Disconnect Google Calendar
 */
export async function disconnectGoogleCalendar() {
  return apiFetch<{ success: boolean }>(ApiRoutes.googleAuthDisconnect, {
    method: "POST",
  });
}

/**
 * Session actions
 */

/**
 * Reschedule a session
 */
export async function rescheduleSession(sessionId: string, newScheduledAt: number) {
  return apiFetch<{ success: boolean }>(ApiRoutes.sessionReschedule(sessionId), {
    method: "POST",
    body: JSON.stringify({ newScheduledAt }),
  });
}

/**
 * Cancel a session
 */
export async function cancelSession(sessionId: string, reason?: string) {
  return apiFetch<{ success: boolean }>(ApiRoutes.sessionCancel(sessionId), {
    method: "POST",
    body: JSON.stringify({ reason: reason || undefined }),
  });
}

/**
 * Update session notes
 */
export async function updateSessionNotes(sessionId: string, notes: string) {
  return apiFetch<{ success: boolean }>(ApiRoutes.sessionNotes(sessionId), {
    method: "PATCH",
    body: JSON.stringify({ notes: notes.trim() }),
  });
}

/**
 * Session packs
 */

export type SessionPackUpdateResponse = {
  success: boolean;
  sessionPack: {
    id: string;
    totalSessions: number;
    remainingSessions: number;
    status: string;
  };
};

export type SessionPackUpdateAction =
  | { action: "increment"; amount?: number }
  | { action: "decrement"; amount?: number }
  | { action: "set"; amount: number }
  | {
      action: "setBoth";
      totalSessions: number;
      remainingSessions: number;
      expectedTotalSessions: number;
      expectedRemainingSessions: number;
    }
  | {
      action: "restore";
      totalSessions: number;
      remainingSessions: number;
      expectedTotalSessions: number;
      expectedRemainingSessions: number;
    };

/**
 * Update a session pack's counts.
 * Keeps the raw fetch so callers can handle the 409 conflict response.
 */
export async function updateSessionPack(
  sessionPackId: string,
  action: SessionPackUpdateAction
) {
  const response = await fetch(ApiRoutes.instructorSessionPack(sessionPackId), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(action),
  });

  let json: Partial<SessionPackUpdateResponse> & { error?: string } = {};
  try {
    json = (await response.json()) as typeof json;
  } catch {
    // Non-JSON body, e.g. an HTML proxy error.
  }

  return { ok: response.ok, status: response.status, json };
}

/**
 * Get a session pack by ID
 */
export async function getSessionPack(id: string) {
  return apiFetch<{
    success: boolean;
    sessionPack: {
      id: string;
      userId: string;
      instructorId: string;
      productId: string;
      totalSessions: number;
      remainingSessions: number;
      status: string;
      purchasedAt: number;
      expiresAt: number | null;
      studentName?: string;
      studentEmail?: string;
      productTitle?: string;
    };
  }>(ApiRoutes.instructorSessionPack(id));
}

/**
 * Preview the email for a session action
 */
export async function previewSessionEmail(
  sessionId: string,
  body: {
    type: "reschedule" | "cancel";
    newScheduledAt?: number;
    reason?: string;
  }
) {
  return apiFetch<{ preview: { subject: string; html: string } }>(
    ApiRoutes.instructorSessionEmailPreview(sessionId),
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  );
}

/**
 * Get details for a student as an instructor
 */
export async function getInstructorStudentDetails(studentId: string) {
  return apiFetch<{
    userId: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    timeZone: string | null;
    sessionPack: {
      id: string;
      totalSessions: number;
      remainingSessions: number;
      expiresAt: number | null;
      status: string;
    } | null;
    sessions: Array<{
      id: string;
      scheduledAt: number;
      completedAt: number | null;
      canceledAt: number | null;
      status: string;
      notes: string | null;
      cancelReason: string | null;
    }>;
  }>(ApiRoutes.instructorStudent(studentId));
}

/**
 * Book a session for a student as an instructor
 */
export async function bookSessionForStudent(
  studentId: string,
  data: {
    scheduledAt: string;
    sessionPackId: string;
    notes?: string;
  }
) {
  return apiFetch<{ success: boolean; sessionId?: string }>(ApiRoutes.instructorStudentSessions(studentId), {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Video
 */

/**
 * Get a Daily meeting token for a room
 */
export async function getVideoToken(roomName: string) {
  const response = await fetch(ApiRoutes.videoToken(roomName));
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Failed to fetch meeting token (${response.status})${detail ? `: ${detail}` : ""}`);
  }
  return response.json() as Promise<{ token: string }>;
}

/**
 * Post recording consent for a session
 */
export async function postVideoConsent(sessionId: string, consent: boolean) {
  const response = await fetch(ApiRoutes.videoConsent(sessionId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ consent }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Failed to save consent (${response.status})${detail ? `: ${detail}` : ""}`);
  }
  return response.json() as Promise<{ recordingConsent: boolean; changed: boolean }>;
}

/**
 * Start an ad-hoc video call
 */
export async function startAdhocCall(data: {
  workspaceId: string;
  recordingConsent: boolean;
}) {
  return apiFetch<{ sessionId: string; roomName: string; roomUrl: string }>(ApiRoutes.videoStartAdhoc, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Retry recording transfer for a session
 */
export async function retryRecordingTransfer(sessionId: string) {
  return apiFetch<{ success?: boolean }>(ApiRoutes.videoRecordingRetry(sessionId), {
    method: "POST",
    credentials: "include",
  });
}

/**
 * Fetch a signed stream URL for a video recording
 */
export async function getVideoRecordingStreamUrl(sessionId: string) {
  const response = await fetch(ApiRoutes.videoRecording(sessionId, "stream"), {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (HTTP ${response.status})`);
  }
  return response.json() as Promise<{ url: string; expiresAt: number }>;
}

/**
 * Admin instructors
 */

export type AdminInstructorListItem = {
  instructorId: string;
  userId: string;
  email: string;
  displayName: string;
  oneOnOneInventory: number;
  groupInventory: number;
  maxActiveStudents: number;
  activeStudentCount: number;
  createdAt: string;
};

/**
 * List instructors for admin
 */
export async function getAdminInstructors(params?: { pageSize?: number; includeInactive?: boolean }) {
  const searchParams = new URLSearchParams();
  if (params?.pageSize) searchParams.set("pageSize", params.pageSize.toString());
  if (params?.includeInactive) searchParams.set("includeInactive", "true");
  const query = searchParams.toString();
  return apiFetch<{ instructors: AdminInstructorListItem[] }>(
    `${ApiRoutes.adminInstructors}${query ? `?${query}` : ""}`
  );
}

/**
 * Get a single instructor for admin
 */
export async function getAdminInstructor(id: string) {
  return apiFetch<{
    id: string;
    name: string;
    slug: string;
    email: string | null;
    discordVoiceChannelUrl?: string | null;
    tagline: string | null;
    bio: string | null;
    specialties: string[];
    background: string[];
    profileImageUrl: string | null;
    profileImageUploadPath: string | null;
    portfolioImages: string[];
    socials: Record<string, string> | null;
    isActive: boolean;
    userId: string | null;
    instructorId: string | null;
    oneOnOneInventory: number;
    groupInventory: number;
    maxActiveStudents: number;
    updatedAt: string | null;
    testimonials: Array<{ id: string; name: string; text: string; createdAt: string }>;
    studentResults: Array<{ id: string; imageUrl: string | null; imageUploadPath: string | null; studentName: string | null; createdAt: string }>;
  }>(ApiRoutes.adminInstructor(id));
}

/**
 * Update an instructor as admin
 */
export async function updateAdminInstructor(
  id: string,
  data: Record<string, unknown>,
  deactivateProducts: boolean = false
) {
  return apiFetch<{
    success: boolean;
    message: string;
    productsDeactivated?: {
      stripeSuccess: string[];
      stripeFailed: { id: string; error: string }[];
    };
    instructor?: {
      id: string;
      name: string;
      slug: string;
      tagline: string | null;
      bio: string | null;
      specialties: string[];
      background: string[];
      profileImageUrl: string | null;
      portfolioImages: string[];
      socials: Record<string, string> | null;
      isActive: boolean;
      userId: string | null;
      instructorId: string | null;
      updatedAt: string;
    };
  }>(ApiRoutes.adminInstructor(id), {
    method: "PUT",
    body: JSON.stringify({ ...data, deactivateProducts }),
  });
}

/**
 * Delete an instructor as admin
 */
export async function deleteAdminInstructor(id: string, hard: boolean = false) {
  const url = `${ApiRoutes.adminInstructor(id)}${hard ? "?hard=true" : ""}`;
  return apiFetch<{ success: boolean; message: string }>(url, {
    method: "DELETE",
  });
}

/**
 * Get students for an instructor as admin
 */
export async function getAdminInstructorStudents(id: string) {
  return apiFetch<{ students: AdminStudent[] }>(ApiRoutes.adminInstructorStudents(id));
}

/**
 * Create a new instructor as admin
 */
export async function createAdminInstructor(data: {
  name: string;
  slug: string;
  email?: string;
  discordVoiceChannelUrl?: string;
  tagline?: string;
  bio?: string;
  specialties?: string[];
  background?: string[];
  profileImageUrl?: string;
  profileImageUploadPath?: string;
  portfolioImages?: string[];
  socials?: Record<string, string>;
  isActive?: boolean;
  userId?: string | null;
  oneOnOneInventory?: number;
  groupInventory?: number;
  maxActiveStudents?: number;
  instructorId?: string | null;
}) {
  return apiFetch<{ success: boolean; message: string; instructor: { id: string } }>(ApiRoutes.adminInstructors, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Upload an instructor image (profile, portfolio, or result)
 */
export async function uploadInstructorImage(formData: FormData) {
  const response = await fetch(ApiRoutes.adminInstructorsUpload, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      error: `HTTP ${response.status}: ${response.statusText}`,
    }));
    throw new ApiFetchError(
      error.error || `Upload failed: ${response.statusText}`,
      response.status,
      error
    );
  }

  return response.json() as Promise<{
    success: boolean;
    url: string;
    storageId: string;
    path: string;
  }>;
}

/**
 * Create a testimonial for an instructor as admin
 */
export async function createAdminTestimonial(
  instructorId: string,
  data: { name: string; text: string }
) {
  return apiFetch<{ success: boolean; message?: string; testimonial?: { id: string; name: string; text: string; createdAt: string } }>(ApiRoutes.adminInstructorTestimonials(instructorId), {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Delete a testimonial for an instructor as admin
 */
export async function deleteAdminTestimonial(instructorId: string, testimonialId: string) {
  return apiFetch<{ success: boolean; message?: string }>(ApiRoutes.adminInstructorTestimonial(instructorId, testimonialId), {
    method: "DELETE",
  });
}

/**
 * Create a student result for an instructor as admin
 */
export async function createAdminStudentResult(
  instructorId: string,
  data: { imageUrl: string; studentName?: string }
) {
  return apiFetch<{ success: boolean; message?: string; studentResult?: { id: string; imageUrl: string | null; imageUploadPath: string | null; studentName: string | null; createdAt: string } }>(ApiRoutes.adminInstructorStudentResults(instructorId), {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Delete a student result for an instructor as admin
 */
export async function deleteAdminStudentResult(instructorId: string, resultId: string) {
  return apiFetch<{ success: boolean; message?: string }>(ApiRoutes.adminInstructorStudentResult(instructorId, resultId), {
    method: "DELETE",
  });
}

/**
 * Backfill instructor images to Convex Storage
 */
export async function backfillInstructorImages(data: {
  baseUrl: string;
  includeStudentResults: boolean;
  dryRun: boolean;
  limit?: number;
}) {
  return apiFetch<{ success?: boolean; summary?: BackfillSummary; error?: string }>(ApiRoutes.adminInstructorsBackfillImages, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Admin students
 */

export type AdminStudent = {
  id: string;
  userId: string;
  email: string | null;
  instructorId: string;
  instructorName: string | null;
  instructorSlug: string | null;
  totalSessions: number;
  remainingSessions: number;
  purchasedAt: number;
  expiresAt: number | null;
  status: "active" | "depleted" | "expired" | "refunded";
  createdAt: number;
};

/**
 * List students for admin
 */
export async function getAdminStudents(params?: { search?: string; includeInactive?: boolean }) {
  const searchParams = new URLSearchParams();
  if (params?.search) searchParams.set("search", params.search);
  if (params?.includeInactive) searchParams.set("includeInactive", "true");
  const query = searchParams.toString();
  return apiFetch<{ items: AdminStudent[]; total: number; page: number; pageSize: number }>(
    `${ApiRoutes.adminStudents}${query ? `?${query}` : ""}`
  );
}

/**
 * Add sessions to a student as admin
 */
export async function addAdminStudentSessions(
  userId: string,
  data: {
    instructorId: string;
    totalSessions: number;
    expiresAt?: string;
  }
) {
  return apiFetch<{ success: boolean; sessionPack?: { id: string; userId: string; instructorId: string; totalSessions: number; remainingSessions: number; status: string; purchasedAt: string; expiresAt: string | null } }>(ApiRoutes.adminStudentSessions(userId), {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Get sessions for a student as admin
 */
export async function getAdminStudentSessions(userId: string) {
  return apiFetch<{
    sessions: Array<{
      id: string;
      scheduledAt: number;
      status: string;
      sessionPackId: string;
      productTitle?: string;
      instructorName?: string;
      studentName?: string;
      studentEmail?: string;
    }>;
  }>(ApiRoutes.adminStudentSessions(userId));
}

/**
 * Admin products
 */

/**
 * List products for admin
 */
export async function getAdminProducts(params?: {
  search?: string;
  instructorId?: string;
  mentorshipType?: string;
  active?: string;
  page?: number;
  pageSize?: number;
}) {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set("page", params.page.toString());
  if (params?.pageSize) searchParams.set("pageSize", params.pageSize.toString());
  if (params?.search) searchParams.set("search", params.search);
  if (params?.instructorId) searchParams.set("instructorId", params.instructorId);
  if (params?.mentorshipType) searchParams.set("mentorshipType", params.mentorshipType);
  if (params?.active) searchParams.set("active", params.active);
  const query = searchParams.toString();
  return apiFetch<{ items: any[]; total: number; page: number; pageSize: number; error?: string }>(
    `${ApiRoutes.adminProducts}${query ? `?${query}` : ""}`
  );
}

/**
 * Get a single product for admin
 */
export async function getAdminProduct(id: string) {
  return apiFetch<any>(ApiRoutes.adminProduct(id));
}

/**
 * Delete a product as admin
 */
export async function deleteAdminProduct(id: string) {
  return apiFetch<{ success: boolean; message?: string }>(ApiRoutes.adminProduct(id), {
    method: "DELETE",
  });
}

/**
 * Admin orders
 */

export type AdminOrder = {
  id: string;
  userId: string;
  userEmail: string | null;
  status: string;
  provider: string;
  totalAmount: string;
  currency: string;
  createdAt: string;
  payments: {
    id: string;
    provider: string;
    providerPaymentId: string;
    amount: string;
    currency: string;
    status: string;
    refundedAmount: string | null;
  }[];
};

/**
 * List orders for admin
 */
export async function getAdminOrders(params?: { status?: string; page?: number; pageSize?: number }) {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set("page", params.page.toString());
  if (params?.pageSize) searchParams.set("pageSize", params.pageSize.toString());
  if (params?.status) searchParams.set("status", params.status);
  const query = searchParams.toString();
  return apiFetch<{ items: AdminOrder[]; total: number; page: number; pageSize: number }>(
    `${ApiRoutes.adminOrders}${query ? `?${query}` : ""}`
  );
}

/**
 * Process a refund as admin
 */
export async function createAdminRefund(data: {
  paymentId: string;
  refundType: "full" | "partial";
  amount?: string;
  reason: string;
  customReason?: string;
}) {
  return apiFetch<{ success: boolean; message?: string }>(ApiRoutes.adminRefunds, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Admin student invitations
 */

export type Invitation = {
  id: string;
  email: string;
  instructorId: string;
  instructorName: string;
  instructorSlug: string;
  clerkInvitationId: string | null;
  expiresAt: string;
  status: "pending" | "accepted" | "expired" | "cancelled";
  createdAt: string;
};

/**
 * List student invitations
 */
export async function getAdminStudentInvitations(status?: string) {
  const params = new URLSearchParams();
  if (status && status !== "all") params.set("status", status);
  const query = params.toString();
  return apiFetch<{ items: Invitation[]; total: number; page: number; pageSize: number }>(
    `${ApiRoutes.adminStudentsInvite}${query ? `?${query}` : ""}`
  );
}

/**
 * Create a student invitation
 */
export async function createStudentInvitation(data: { email: string; instructorId: string }) {
  return apiFetch<{ success: boolean; invitationId?: string; invitationSent?: boolean }>(ApiRoutes.adminStudentsInvite, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Admin onboarding
 */

/**
 * Preview admin onboarding
 */
export async function previewAdminOnboarding(data: {
  email: string;
  instructors: { instructorId: string; sessionsPerInstructor: number; expiresAt?: number }[];
  isSeparateStudentRecord?: boolean;
  notes?: string;
  capacityOverrideReason?: string;
}) {
  return apiFetch<unknown>(ApiRoutes.adminStudentsOnboard + "/preview", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Submit admin onboarding
 */
export async function submitAdminOnboarding(data: {
  email: string;
  instructors: { instructorId: string; sessionsPerInstructor: number; expiresAt?: number }[];
  isSeparateStudentRecord?: boolean;
  notes?: string;
  capacityOverrideReason?: string;
  source?: string;
}) {
  return apiFetch<{
    onboardingId: string;
    status: "processing" | "failed";
    failureReason?: string;
    clerkInvitationId: string | null;
    perInstructor: {
      instructorId: string;
      workspaceId?: string;
      seatReservationId?: string;
      sessionPackId?: string;
      isRenewal: boolean;
      clerkInvitationId?: string;
    }[];
    existingWorkspaceIds: string[];
  }>(ApiRoutes.adminStudentsOnboard, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Retry an onboarding
 */
export async function retryAdminOnboarding(onboardingId: string) {
  return apiFetch<{
    onboardingId: string;
    status: "processing" | "failed";
    failureReason?: string;
    attemptCount?: number;
  }>(ApiRoutes.adminOnboardingRetry(onboardingId), {
    method: "POST",
  });
}

/**
 * Admin workspaces
 */

/**
 * List workspaces for admin
 */
export async function getAdminWorkspaces(params?: { type?: string; numItems?: number; cursor?: string }) {
  const searchParams = new URLSearchParams();
  if (params?.type) searchParams.set("type", params.type);
  if (params?.numItems) searchParams.set("numItems", params.numItems.toString());
  if (params?.cursor) searchParams.set("cursor", params.cursor);
  const query = searchParams.toString();
  return apiFetch<{ items: any[]; continueCursor: string | null; isDone: boolean }>(
    `${ApiRoutes.adminWorkspaces}${query ? `?${query}` : ""}`
  );
}

/**
 * Get a workspace for admin
 */
export async function getAdminWorkspace(id: string) {
  return apiFetch<any>(ApiRoutes.adminWorkspace(id));
}

/**
 * Update a workspace as admin
 */
export async function updateAdminWorkspace(
  id: string,
  data: { name?: string; description?: string; isPublic?: boolean }
) {
  return apiFetch<any>(ApiRoutes.adminWorkspace(id), {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

/**
 * Delete a workspace as admin
 */
export async function deleteAdminWorkspace(id: string) {
  return apiFetch<{ success: boolean }>(ApiRoutes.adminWorkspace(id), {
    method: "DELETE",
  });
}

/**
 * Update workspace members as admin
 */
export async function updateAdminWorkspaceMembers(
  id: string,
  data: { newOwnerId?: string; newInstructorId?: string | null }
) {
  return apiFetch<any>(ApiRoutes.adminWorkspaceMembers(id), {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

/**
 * Create an admin-student workspace
 */
export async function createAdminStudentWorkspace(data: {
  studentUserId: string;
  name?: string;
  description?: string;
  isPublic?: boolean;
}) {
  return apiFetch<{ id: string; name: string; description: string | null; type: string; ownerId: string }>(ApiRoutes.adminWorkspaceAdminStudent, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Create an admin-instructor workspace
 */
export async function createAdminInstructorWorkspace(data: {
  instructorId: string;
  name?: string;
  description?: string;
  isPublic?: boolean;
}) {
  return apiFetch<{ id: string; name: string; description: string | null; type: string; instructorId: string }>(ApiRoutes.adminWorkspaceAdminInstructor, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Admin stats
 */

export type AdminStats = {
  totalActiveStudents: number;
  revenueThisMonth: number;
  revenueLastMonth: number;
  revenueChange: number;
  revenueThisYear: number;
  hasRevenueData: boolean;
  hasStudentData: boolean;
  hasHistoricalRevenue: boolean;
};

/**
 * Get admin dashboard stats
 */
export async function getAdminStats() {
  return apiFetch<AdminStats>(ApiRoutes.adminStats);
}

/**
 * Admin audit logs
 */

/**
 * List admin audit logs
 */
export async function getAdminAuditLogs(params?: { numItems?: number; cursor?: string }) {
  const searchParams = new URLSearchParams();
  if (params?.numItems) searchParams.set("numItems", params.numItems.toString());
  if (params?.cursor) searchParams.set("cursor", params.cursor);
  const query = searchParams.toString();
  return apiFetch<{ items: any[]; continueCursor: string | null; isDone: boolean }>(
    `${ApiRoutes.adminAuditLogs}${query ? `?${query}` : ""}`
  );
}

/**
 * Bookings
 */

export type GoogleBooking = {
  id: string;
  startUtc: number;
  endUtc: number;
  status: "pending" | "confirmed" | "canceled" | "completed";
};

/**
 * Get the current user's Google Calendar bookings
 */
export async function getMyBookings() {
  return apiFetch<{ success: boolean; bookings: GoogleBooking[] }>(ApiRoutes.bookingsMe);
}

/**
 * Discord
 */

/**
 * Sync the current user's Discord role
 */
export async function syncDiscordRole() {
  return apiFetch<{ success: boolean }>(ApiRoutes.userDiscordSyncRole, {
    method: "POST",
  });
}

/**
 * Sync the current user's instructor role
 */
export async function syncInstructorRole() {
  return apiFetch<{ success: boolean }>(ApiRoutes.instructorSyncRole, {
    method: "POST",
  });
}

/**
 * Backfill summary
 */

export type BackfillSummary = {
  processedProfiles: number;
  processedInstructors: number;
  processedPortfolioImages: number;
  processedStudentResults: number;
  skipped: number;
  errors: Array<{ kind: string; id: string; message: string }>;
};
