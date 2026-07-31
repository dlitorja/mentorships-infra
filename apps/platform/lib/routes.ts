/**
 * Centralized API route definitions for apps/platform.
 *
 * Use these constants/functions instead of repeating `/api/...` strings
 * across components. This keeps endpoint names in one place and makes
 * refactors (renaming, versioning) safer.
 *
 * For routes that include dynamic segments, export small builder functions
 * that return the full path. For simple static routes, export string constants.
 */

export const ApiRoutes = {
  // Admin instructors
  adminInstructors: "/api/admin/instructors",
  adminInstructor: (id: string) => `/api/admin/instructors/${id}`,
  adminInstructorStudents: (id: string) => `/api/admin/instructors/${id}/students`,
  adminInstructorTestimonials: (id: string) => `/api/admin/instructors/${id}/testimonials`,
  adminInstructorTestimonial: (id: string, testimonialId: string) =>
    `/api/admin/instructors/${id}/testimonials/${testimonialId}`,
  adminInstructorStudentResults: (id: string) => `/api/admin/instructors/${id}/student-results`,
  adminInstructorStudentResult: (id: string, resultId: string) =>
    `/api/admin/instructors/${id}/student-results/${resultId}`,
  adminInstructorsUpload: "/api/admin/instructors/upload",
  adminInstructorsBackfillImages: "/api/admin/instructors/backfill-images",

  // Admin products
  adminProducts: "/api/admin/products",
  adminProduct: (id: string) => `/api/admin/products/${id}`,
  productsCreateFromStripe: "/api/products/create-from-stripe",

  // Admin students
  adminStudents: "/api/admin/students",
  adminStudentSessions: (userId: string) => `/api/admin/students/${userId}/sessions`,
  adminStudentsInvite: "/api/admin/students/invite",

  // Admin workspaces
  adminWorkspaces: "/api/admin/workspaces",
  adminWorkspace: (id: string) => `/api/admin/workspaces/${id}`,
  adminWorkspaceMembers: (id: string) => `/api/admin/workspaces/${id}/members`,
  adminWorkspaceAdminStudent: "/api/admin/workspaces/admin-student",
  adminWorkspaceAdminInstructor: "/api/admin/workspaces/admin-instructor",

  // Admin misc
  adminStats: "/api/admin/stats",
  adminOrders: "/api/admin/orders",
  adminRefunds: "/api/admin/refunds",
  adminOnboardingRetry: (id: string) => `/api/admin/onboardings/${id}/retry`,
  adminStudentsOnboard: "/api/admin/students/onboard",
  adminAuditLogs: "/api/admin/audit-logs",

  // Public products
  products: "/api/products",
  product: (id: string) => `/api/products/${id}`,

  // Session packs
  sessionPacks: "/api/session-packs",
  sessionPacksMe: "/api/session-packs/me",

  // Instructor session packs
  instructorSessionPack: (id: string) => `/api/instructor/session-packs/${id}`,

  // Bookings
  bookings: "/api/bookings",
  bookingsSeries: "/api/bookings/series",
  bookingsNotify: "/api/bookings/notify",
  bookingsMe: "/api/bookings/me",

  // Sessions
  sessions: "/api/sessions",
  sessionReschedule: (id: string) => `/api/sessions/${id}/reschedule`,
  sessionCancel: (id: string) => `/api/sessions/${id}/cancel`,
  sessionNotes: (id: string) => `/api/sessions/${id}/notes`,

  // Instructor endpoints
  instructorProfile: "/api/instructor/profile",
  instructorSettings: "/api/instructor/settings",
  instructorStudents: "/api/instructor/students",
  instructorStudent: (id: string) => `/api/instructor/students/${id}`,
  instructorStudentSessions: (id: string) => `/api/instructor/students/${id}/sessions`,
  instructorTestimonials: "/api/instructor/testimonials",
  instructorTestimonial: (id: string) => `/api/instructor/testimonials/${id}`,
  instructorStudentResults: "/api/instructor/student-results",
  instructorStudentResult: (id: string) => `/api/instructor/student-results/${id}`,
  instructorUploadImage: "/api/instructor/upload-image",
  instructorSyncRole: "/api/instructor/sync-role",
  instructorSession: (id: string) => `/api/instructor/sessions/${id}`,
  instructorSessionEmailPreview: (id: string) => `/api/instructor/sessions/${id}/email-preview`,

  // Instructor availability
  instructorAvailability: (instructorId: string) => `/api/instructors/${instructorId}/availability`,
  instructorAvailabilityPreview: (instructorId: string) =>
    `/api/instructors/${instructorId}/availability-preview`,

  // Google Calendar
  googleCalendars: "/api/google/calendars",
  googleCalendarsSelect: "/api/google/calendars/select",
  googleAuthDisconnect: "/api/auth/google/disconnect",

  // Discord
  userDiscordSyncRole: "/api/user/discord/sync-role",

  // Waitlist
  waitlist: "/api/waitlist",

  // Onboarding
  onboardingSubmit: "/api/onboarding/submit",
  onboardingUploads: "/api/onboarding/uploads",

  // Contacts
  contacts: "/api/contacts",

  // Checkout
  checkoutStripe: "/api/checkout/stripe",
  checkoutPayPal: "/api/checkout/paypal",
  checkoutVerify: "/api/checkout/verify",
  checkoutSuccess: "/api/checkout/success",
  checkoutCancel: "/api/checkout/cancel",

  // User settings
  userSettings: "/api/user/settings",

  // Video
  videoStartAdhoc: "/api/video/start-adhoc",
  videoConsent: (target: string) => `/api/video/consent/${target}`,
  videoToken: (roomName: string) => `/api/video/token/${encodeURIComponent(roomName)}`,
  videoRecordingRetry: (sessionId: string) => `/api/video/recording/${sessionId}/retry`,
  videoRecording: (sessionId: string, kind?: "stream" | "download") => {
    const path = `/api/video/recording/${sessionId}`;
    return kind ? `${path}?kind=${kind}` : path;
  },

  // Auth
  authSync: "/api/auth/sync",

  // Admin / Convex role seed
  adminConvexSeedRole: "/api/admin/convex/seed-role",
  adminConvexSetClerkId: "/api/admin/convex/set-clerk-id",

  // Session counts
  sessionCounts: "/api/session-counts",

  // Video rooms
  videoRooms: "/api/video/rooms",

  // Products by stripe price
  productsByStripePrice: "/api/products/by-stripe-price",

  // Webhooks
  webhooksDailyRecordings: "/api/webhooks/daily/recordings",

  // Admin upload
  adminUpload: "/api/admin/upload",
} as const;

/** Backwards-compatible alias for code that already imports `apiRoutes`. */
export const apiRoutes = ApiRoutes;
