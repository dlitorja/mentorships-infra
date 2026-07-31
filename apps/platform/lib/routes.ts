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
  adminInstructor: (id: string) => `/api/admin/instructors/${encodeURIComponent(id)}`,
  adminInstructorStudents: (id: string) => `/api/admin/instructors/${encodeURIComponent(id)}/students`,
  adminInstructorTestimonials: (id: string) => `/api/admin/instructors/${encodeURIComponent(id)}/testimonials`,
  adminInstructorTestimonial: (id: string, testimonialId: string) =>
    `/api/admin/instructors/${encodeURIComponent(id)}/testimonials/${encodeURIComponent(testimonialId)}`,
  adminInstructorStudentResults: (id: string) => `/api/admin/instructors/${encodeURIComponent(id)}/student-results`,
  adminInstructorStudentResult: (id: string, resultId: string) =>
    `/api/admin/instructors/${encodeURIComponent(id)}/student-results/${encodeURIComponent(resultId)}`,
  adminInstructorsUpload: "/api/admin/instructors/upload",
  adminInstructorsBackfillImages: "/api/admin/instructors/backfill-images",

  // Admin products
  adminProducts: "/api/admin/products",
  adminProduct: (id: string) => `/api/admin/products/${encodeURIComponent(id)}`,
  productsCreateFromStripe: "/api/products/create-from-stripe",

  // Admin students
  adminStudents: "/api/admin/students",
  adminStudentSessions: (userId: string) => `/api/admin/students/${encodeURIComponent(userId)}/sessions`,
  adminStudentsInvite: "/api/admin/students/invite",
  adminStudentsOnboard: "/api/admin/students/onboard",
  adminStudentsOnboardPreview: "/api/admin/students/onboard/preview",

  // Admin workspaces
  adminWorkspaces: "/api/admin/workspaces",
  adminWorkspace: (id: string) => `/api/admin/workspaces/${encodeURIComponent(id)}`,
  adminWorkspaceMembers: (id: string) => `/api/admin/workspaces/${encodeURIComponent(id)}/members`,
  adminWorkspaceAdminStudent: "/api/admin/workspaces/admin-student",
  adminWorkspaceAdminInstructor: "/api/admin/workspaces/admin-instructor",

  // Admin misc
  adminStats: "/api/admin/stats",
  adminOrders: "/api/admin/orders",
  adminRefunds: "/api/admin/refunds",
  adminOnboardingRetry: (id: string) => `/api/admin/onboardings/${encodeURIComponent(id)}/retry`,
  adminAuditLogs: "/api/admin/audit-logs",

  // Public products
  products: "/api/products",
  product: (id: string) => `/api/products/${encodeURIComponent(id)}`,

  // Session packs
  sessionPacks: "/api/session-packs",
  sessionPacksMe: "/api/session-packs/me",

  // Instructor session packs
  instructorSessionPack: (id: string) => `/api/instructor/session-packs/${encodeURIComponent(id)}`,

  // Bookings
  bookings: "/api/bookings",
  bookingsSeries: "/api/bookings/series",
  bookingsNotify: "/api/bookings/notify",
  bookingsMe: "/api/bookings/me",

  // Sessions
  sessions: "/api/sessions",
  sessionReschedule: (id: string) => `/api/sessions/${encodeURIComponent(id)}/reschedule`,
  sessionCancel: (id: string) => `/api/sessions/${encodeURIComponent(id)}/cancel`,
  sessionNotes: (id: string) => `/api/sessions/${encodeURIComponent(id)}/notes`,

  // Instructor endpoints
  instructorProfile: "/api/instructor/profile",
  instructorSettings: "/api/instructor/settings",
  instructorStudents: "/api/instructor/students",
  instructorStudent: (id: string) => `/api/instructor/students/${encodeURIComponent(id)}`,
  instructorStudentSessions: (id: string) => `/api/instructor/students/${encodeURIComponent(id)}/sessions`,
  instructorTestimonials: "/api/instructor/testimonials",
  instructorTestimonial: (id: string) => `/api/instructor/testimonials/${encodeURIComponent(id)}`,
  instructorStudentResults: "/api/instructor/student-results",
  instructorStudentResult: (id: string) => `/api/instructor/student-results/${encodeURIComponent(id)}`,
  instructorUploadImage: "/api/instructor/upload-image",
  instructorSyncRole: "/api/instructor/sync-role",
  instructorSession: (id: string) => `/api/instructor/sessions/${encodeURIComponent(id)}`,
  instructorSessionEmailPreview: (id: string) => `/api/instructor/sessions/${encodeURIComponent(id)}/email-preview`,

  // Instructor availability
  instructorAvailability: (instructorId: string) => `/api/instructors/${encodeURIComponent(instructorId)}/availability`,
  instructorAvailabilityPreview: (instructorId: string) =>
    `/api/instructors/${encodeURIComponent(instructorId)}/availability-preview`,

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
  videoConsent: (target: string) => `/api/video/consent/${encodeURIComponent(target)}`,
  videoToken: (roomName: string) => `/api/video/token/${encodeURIComponent(roomName)}`,
  videoRecordingRetry: (sessionId: string) => `/api/video/recording/${encodeURIComponent(sessionId)}/retry`,
  videoRecording: (sessionId: string) => `/api/video/recording/${encodeURIComponent(sessionId)}`,

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
