import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    userId: v.string(),
    email: v.string(),
    clerkId: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    role: v.optional(v.union(v.literal("student"), v.literal("instructor"), v.literal("admin"), v.literal("video_editor"), v.literal("support"))),
    timeZone: v.optional(v.string()),
    legacyId: v.optional(v.string()),
    deletedAt: v.optional(v.number()),
    deletedBy: v.optional(v.string()),
    hardDeletedAt: v.optional(v.number()),
    // PR admin-onboarding #1: set when a Convex-only split is requested
    // (adminOnboardings.isSeparateStudentRecord = true). The Clerk account
    // stays single, but Convex distinguishes the split record so per-pair
    // renewal detection + per-pair session-pack ownership remain correct.
    onboardingAlias: v.optional(v.string()),
  }).index("by_email", ["email"])
    .index("by_clerkId", ["clerkId"])
    .index("by_userId", ["userId"])
    .index("by_deletedAt", ["deletedAt"])
    .index("by_onboardingAlias", ["onboardingAlias"]),

  instructors: defineTable({
    userId: v.optional(v.string()),
    name: v.optional(v.string()),
    slug: v.optional(v.string()),
    email: v.optional(v.string()),
    googleCalendarId: v.optional(v.string()),
    googleRefreshToken: v.optional(v.string()),
    googleAvailabilityCalendarIds: v.optional(v.array(v.string())),
    // Voice channel where sessions take place until video calling is implemented
    discordVoiceChannelUrl: v.optional(v.string()),
    timeZone: v.optional(v.string()),
    workingHours: v.optional(v.any()),
    bufferMinutesBetweenSessions: v.optional(v.number()),
    minBookingLeadMinutes: v.optional(v.number()),
    maxBookingAdvanceDays: v.optional(v.number()),
    blockedDateRanges: v.optional(v.array(v.object({
      start: v.string(),
      end: v.string(),
      label: v.optional(v.string()),
    }))),
    maxActiveStudents: v.optional(v.number()),
    bio: v.optional(v.string()),
    pricing: v.optional(v.string()),
    oneOnOneInventory: v.optional(v.number()),
    groupInventory: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
    isNew: v.optional(v.boolean()),
    background: v.optional(v.array(v.string())),
    specialties: v.optional(v.array(v.string())),
    portfolioImages: v.optional(v.array(v.string())),
    portfolioImageStorageIds: v.optional(v.array(v.string())),
    profileImageUrl: v.optional(v.string()),
    profileImageStorageId: v.optional(v.string()),
    profileImageUploadPath: v.optional(v.string()),
    socials: v.optional(v.any()),
    legacyInstructorRef: v.optional(v.string()),
    tagline: v.optional(v.string()),
    updatedAt: v.optional(v.number()),
  }).index("by_userId", ["userId"])
    .index("by_slug", ["slug"])
    .index("by_deletedAt", ["deletedAt"])
    .index("by_email", ["email"]),

  sessions: defineTable({
    instructorId: v.id("instructors"),
    studentId: v.string(),
    // Widen: PR #4a made this optional to support ad-hoc calls
    // (instructor-started catch-up calls outside scheduled sessions).
    // Existing scheduled-call rows have a value; ad-hoc rows leave
    // it undefined. No backfill needed.
    sessionPackId: v.optional(v.id("sessionPacks")),
    scheduledAt: v.number(),
    completedAt: v.optional(v.number()),
    canceledAt: v.optional(v.number()),
    status: v.union(v.literal("scheduled"), v.literal("completed"), v.literal("canceled"), v.literal("no_show")),
    recordingConsent: v.boolean(),
    // PR #4a: per-party recording consent. The combined `recordingConsent`
    // (above) is recomputed as `instructorRecordingConsent && studentRecordingConsent`
    // whenever either party records their choice via `recordConsent`.
    // Either party declining flips the combined value to `false` —
    // matches the plan's "If either party declines consent, the call
    // proceeds without recording" semantic
    // (`docs/plans/video-calling.md:343`). Nullable until each party
    // has made a choice (the booking flow defaults to `true` for both).
    instructorRecordingConsent: v.optional(v.boolean()),
    studentRecordingConsent: v.optional(v.boolean()),
    // PR #4a: snapshot of `enable_recording` on the Daily room at the
    // time the room was provisioned. Used to detect drift after a late
    // consent change — if the new combined consent differs, the consent
    // route calls Daily's PATCH /rooms endpoint to reconcile.
    roomRecordingEnabled: v.optional(v.boolean()),
    recordingUrl: v.optional(v.string()),
    recordingExpiresAt: v.optional(v.number()),
    videoRoomUrl: v.optional(v.string()),
    videoRoomName: v.optional(v.string()),
    videoSessionStartedAt: v.optional(v.number()),
    callStartedAt: v.optional(v.number()),
    callEndedAt: v.optional(v.number()),
    isAdhoc: v.optional(v.boolean()),
    recordingDurationSeconds: v.optional(v.number()),
    recordingId: v.optional(v.string()),
    // Post-webhook Daily → B2 transfer pipeline state. The webhook
    // handler sets this to "pending" + triggers a Trigger.dev task;
    // the task flips it through "uploading" → "ready" (B2 key written
    // to `recordingUrl`) or → "failed" (terminal, surfaced in the UI
    // with a manual-retry affordance). `recordingUrl` MUST NOT be
    // considered valid until `recordingTransferStatus === "ready"` —
    // pre-fix sessions wrote Daily's transient `s3_key` here, which
    // caused Play/Download to 404 (see PR #video-recording-to-b2).
    recordingTransferStatus: v.optional(v.union(
      v.literal("pending"),
      v.literal("uploading"),
      v.literal("ready"),
      v.literal("failed")
    )),
    // Capture Daily's raw s3_key from the webhook payload for
    // diagnostics — never read by the UI, only logged + shown on
    // the admin audit query.
    recordingDailyS3Key: v.optional(v.string()),
    recordingTransferAttempts: v.optional(v.number()),
    recordingTransferError: v.optional(v.string()),
    googleCalendarEventId: v.optional(v.string()),
    notes: v.optional(v.string()),
    cancelReason: v.optional(v.string()),
    deletedAt: v.optional(v.number()),
    legacyId: v.optional(v.string()),
  }).index("by_studentId", ["studentId"])
    .index("by_instructorId", ["instructorId"])
    .index("by_sessionPackId", ["sessionPackId"])
    .index("by_status", ["status"])
    .index("by_scheduledAt", ["scheduledAt"])
    .index("by_studentId_status_scheduledAt", ["studentId", "status", "scheduledAt"])
    .index("by_googleCalendarEventId", ["googleCalendarEventId"])
    .index("by_instructorId_status_scheduledAt", ["instructorId", "status", "scheduledAt"])
    .index("by_videoRoomName", ["videoRoomName"])
    .index("by_instructorId_isAdhoc", ["instructorId", "isAdhoc"])
    // PR #4c-1: lets `getCallRecordingsForWorkspace` return
    // recordings for the exact (instructor, student) pair
    // without filtering across the instructor's full session
    // history. Without this index the previous `.take(50)` on
    // `by_instructorId_status_scheduledAt` would silently drop
    // recordings for any student whose sessions weren't among
    // the instructor's 50 most recent overall.
    .index("by_instructorId_studentId", ["instructorId", "studentId"]),

  seatReservations: defineTable({
    instructorId: v.id("instructors"),
    userId: v.string(),
    sessionPackId: v.id("sessionPacks"),
    seatExpiresAt: v.number(),
    gracePeriodEndsAt: v.optional(v.number()),
    finalWarningNotificationSentAt: v.optional(v.number()),
    status: v.union(v.literal("active"), v.literal("grace"), v.literal("released")),
    legacyId: v.optional(v.string()),
  }).index("by_instructorId", ["instructorId"])
    .index("by_userId", ["userId"])
    .index("by_status", ["status"])
    .index("by_seatExpiresAt", ["seatExpiresAt"])
    .index("by_instructorId_status", ["instructorId", "status"])
    .index("by_userId_instructorId", ["userId", "instructorId"])
    .index("by_sessionPackId", ["sessionPackId"]),

  sessionPacks: defineTable({
    userId: v.string(),
    instructorId: v.id("instructors"),
    totalSessions: v.number(),
    remainingSessions: v.number(),
    purchasedAt: v.number(),
    expiresAt: v.optional(v.number()),
    status: v.union(v.literal("active"), v.literal("depleted"), v.literal("expired"), v.literal("refunded")),
    paymentId: v.optional(v.id("payments")),
    deletedAt: v.optional(v.number()),
    legacyId: v.optional(v.string()),
  }).index("by_userId", ["userId"])
    .index("by_instructorId", ["instructorId"])
    .index("by_status", ["status"])
    .index("by_expiresAt", ["expiresAt"])
    .index("by_userId_instructorId_status", ["userId", "instructorId", "status"])
    .index("by_paymentId", ["paymentId"])
    .index("by_userId_status_expiresAt", ["userId", "status", "expiresAt"]),

  orders: defineTable({
    userId: v.string(),
    status: v.union(v.literal("pending"), v.literal("paid"), v.literal("refunded"), v.literal("failed"), v.literal("canceled")),
    provider: v.union(v.literal("stripe"), v.literal("paypal")),
    totalAmount: v.string(),
    currency: v.string(),
    deletedAt: v.optional(v.number()),
    legacyId: v.optional(v.string()),
  }).index("by_userId", ["userId"])
    .index("by_status", ["status"])
    .index("by_userId_status", ["userId", "status"]),

  payments: defineTable({
    orderId: v.id("orders"),
    provider: v.union(v.literal("stripe"), v.literal("paypal")),
    providerPaymentId: v.string(),
    amount: v.string(),
    currency: v.string(),
    status: v.union(v.literal("pending"), v.literal("completed"), v.literal("refunded"), v.literal("failed")),
    refundedAmount: v.optional(v.string()),
    deletedAt: v.optional(v.number()),
    legacyId: v.optional(v.string()),
  }).index("by_orderId", ["orderId"])
    .index("by_status", ["status"])
    .index("by_provider_providerPaymentId", ["provider", "providerPaymentId"]),

  products: defineTable({
    instructorId: v.optional(v.string()),
    title: v.string(),
    description: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    price: v.string(),
    currency: v.string(),
    sessionsPerPack: v.number(),
    validityDays: v.number(),
    stripePriceId: v.optional(v.string()),
    stripeProductId: v.optional(v.string()),
    paypalProductId: v.optional(v.string()),
    mentorshipType: v.string(),
    active: v.boolean(),
    deletedAt: v.optional(v.number()),
    legacyId: v.optional(v.string()),
  }).index("by_instructorId", ["instructorId"])
    .index("by_stripePriceId", ["stripePriceId"])
    .index("by_active", ["active"]),

  // Bookings represent calendar reservations created via the booking API
  bookings: defineTable({
    instructorId: v.id("instructors"),
    // UTC millis for start and end
    startUtc: v.number(),
    endUtc: v.number(),
    timezone: v.string(),
    studentEmail: v.string(),
    studentName: v.string(),
    status: v.union(v.literal("pending"), v.literal("confirmed"), v.literal("canceled"), v.literal("completed")),
    eventCalendarId: v.optional(v.string()),
    googleEventId: v.optional(v.string()),
    idempotencyKey: v.string(),
    createdByUserId: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    // Completion metadata
    completedAt: v.optional(v.number()),
    completedByUserId: v.optional(v.string()),
    completionNotes: v.optional(v.string()),
    // Lightweight history log
    history: v.optional(
      v.array(
        v.object({
          action: v.union(v.literal("created"), v.literal("confirmed"), v.literal("canceled"), v.literal("completed")),
          at: v.number(),
          byUserId: v.optional(v.string()),
          info: v.optional(v.string()),
        })
      )
    ),
  })
    .index("by_instructorId", ["instructorId"]) 
    .index("by_idempotencyKey", ["idempotencyKey"]) 
    .index("by_status", ["status"]) 
    .index("by_studentEmail", ["studentEmail"]) ,

  instructorProfiles: defineTable({
    userId: v.optional(v.string()),
    legacyInstructorRef: v.optional(v.string()),
    email: v.optional(v.string()),
    name: v.string(),
    slug: v.string(),
    tagline: v.optional(v.string()),
    bio: v.optional(v.string()),
    specialties: v.optional(v.array(v.string())),
    background: v.optional(v.array(v.string())),
    profileImageUrl: v.optional(v.string()),
    profileImageStorageId: v.optional(v.string()),
    profileImageUploadPath: v.optional(v.string()),
    portfolioImages: v.optional(v.array(v.string())),
    portfolioImageStorageIds: v.optional(v.array(v.string())),
    socials: v.optional(v.any()),
    isActive: v.boolean(),
    isNew: v.optional(v.boolean()),
  }).index("by_slug", ["slug"])
    .index("by_userId", ["userId"])
    .index("by_email", ["email"])
    .index("by_legacyInstructorRef", ["legacyInstructorRef"])
    .index("by_isActive", ["isActive"]),

  instructorTestimonials: defineTable({
    instructorId: v.optional(v.string()), // Using string to allow legacy IDs
    name: v.string(),
    text: v.string(),
    role: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    legacyId: v.optional(v.string()),
  }).index("by_instructorId", ["instructorId"]),

  studentResults: defineTable({
    instructorId: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    imageStorageId: v.optional(v.string()),
    imageUploadPath: v.optional(v.string()),
    studentName: v.optional(v.string()),
    createdBy: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    legacyId: v.optional(v.string()),
  }).index("by_instructorId", ["instructorId"])
    .index("by_createdBy", ["createdBy"]),

  workspaces: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    ownerId: v.string(),
    instructorId: v.optional(v.id("instructors")),
    imageUrl: v.optional(v.string()),
    isPublic: v.boolean(),
    deletedAt: v.optional(v.number()),
    seatReservationId: v.optional(v.id("seatReservations")),
    endedAt: v.optional(v.number()),
    studentImageCount: v.number(),
    instructorImageCount: v.number(),
    type: v.optional(v.union(v.literal("mentorship"), v.literal("admin_student"), v.literal("admin_instructor"))),
  }).index("by_ownerId", ["ownerId"])
    .index("by_instructorId", ["instructorId"])
    .index("by_instructorId_deletedAt", ["instructorId", "deletedAt"])
    .index("by_seatReservationId", ["seatReservationId"])
    .index("by_endedAt", ["endedAt"])
    .index("by_type", ["type"])
    // PR #4c-1: lets `assertParticipantForSession` look up the
    // exact workspace for an instructor + student pair in one
    // indexed read, instead of an unbounded `.take(N)` + in-memory
    // scan that would silently deny access to instructors past
    // the cap. Additive — no migration needed.
    .index("by_instructorId_ownerId", ["instructorId", "ownerId"]),

  workspaceNotes: defineTable({
    workspaceId: v.id("workspaces"),
    title: v.string(),
    content: v.string(),
    createdBy: v.string(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
    imageUrl: v.optional(v.string()),
    sessionId: v.optional(v.id("sessions")),
    // True for the single auto-created "live session note" that is
    // pinned at the top of the Notes tab while a video call is
    // active. Exactly one row per session has this flag set; the
    // internal mutation that creates it is idempotent via the
    // `by_sessionId_isLiveSessionNote` index below.
    isLiveSessionNote: v.optional(v.boolean()),
  }).index("by_workspaceId", ["workspaceId"])
    .index("by_workspaceId_and_deletedAt", ["workspaceId", "deletedAt"])
    .index("by_createdBy", ["createdBy"])
    .index("by_workspaceId_sessionId", ["workspaceId", "sessionId"])
    .index("by_sessionId_isLiveSessionNote", ["sessionId", "isLiveSessionNote"]),

  workspaceNoteComments: defineTable({
    noteId: v.id("workspaceNotes"),
    content: v.string(),
    createdBy: v.string(),
    createdAt: v.number(),
    deletedAt: v.optional(v.number()),
    storageId: v.optional(v.string()),
  }).index("by_noteId", ["noteId"]),

  workspaceLinks: defineTable({
    workspaceId: v.id("workspaces"),
    url: v.string(),
    title: v.optional(v.string()),
    createdBy: v.string(),
    deletedAt: v.optional(v.number()),
    sessionId: v.optional(v.id("sessions")),
  }).index("by_workspaceId", ["workspaceId"])
    .index("by_workspaceId_sessionId", ["workspaceId", "sessionId"]),

  workspaceImages: defineTable({
    workspaceId: v.id("workspaces"),
    imageUrl: v.string(),
    storageId: v.optional(v.string()),
    createdBy: v.string(),
    deletedAt: v.optional(v.number()),
    sessionId: v.optional(v.id("sessions")),
  }).index("by_workspaceId", ["workspaceId"])
    .index("by_workspaceId_and_deletedAt", ["workspaceId", "deletedAt"])
    .index("by_workspaceId_sessionId", ["workspaceId", "sessionId"]),

  instructorResources: defineTable({
    instructorId: v.id("instructors"),
    workspaceId: v.id("workspaces"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    contentType: v.string(),
    size: v.number(),
    type: v.union(v.literal("image"), v.literal("file")),
    createdBy: v.string(),
    deletedAt: v.optional(v.number()),
    createdAt: v.number(),
    // PR #5: tags the resource to an active video-call session. Drives
    // the "Shared during current call" subpanel in the Links tab,
    // unioned with `workspaceLinks.sessionId`. Optional so existing
    // pre-#5 rows stay valid; pre-#5 resources do not appear in the
    // subpanel (matches the documented pre-#4b links limitation).
    sessionId: v.optional(v.id("sessions")),
  }).index("by_instructorId", ["instructorId"])
    .index("by_workspaceId", ["workspaceId"])
    .index("by_instructorId_and_workspaceId", ["instructorId", "workspaceId"])
    .index("by_workspaceId_sessionId", ["workspaceId", "sessionId"]),

  workspaceMessages: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.string(),
    content: v.string(),
    type: v.union(v.literal("text"), v.literal("image"), v.literal("file")),
    senderRole: v.optional(v.union(v.literal("instructor"), v.literal("student"), v.literal("admin"))),
    // Set when a chat message is posted while a video call is active
    // in the workspace. The Chat tab renders a banner that explains
    // this replaces Daily's in-call chat. The Conversations subpanel
    // for the live call can be filtered through `by_workspaceId_sessionId`.
    sessionId: v.optional(v.id("sessions")),
  }).index("by_workspaceId", ["workspaceId"])
    .index("by_userId", ["userId"])
    .index("by_senderRole", ["senderRole"])
    .index("by_workspaceId_sessionId", ["workspaceId", "sessionId"]),

  workspaceExports: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.string(),
    format: v.union(v.literal("pdf"), v.literal("markdown"), v.literal("zip")),
    status: v.union(v.literal("pending"), v.literal("processing"), v.literal("completed"), v.literal("failed")),
    downloadUrl: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
  }).index("by_workspaceId", ["workspaceId"])
    .index("by_userId", ["userId"])
    .index("by_status", ["status"]),

  workspaceRetentionNotifications: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.string(),
    notificationType: v.union(v.literal("expiry_warning"), v.literal("deleted")),
    sentAt: v.number(),
    acknowledgedAt: v.optional(v.number()),
  }).index("by_workspaceId", ["workspaceId"])
    .index("by_userId", ["userId"])
    .index("by_workspaceId_userId", ["workspaceId", "userId"]),

  workspaceAuditLogs: defineTable({
    workspaceId: v.id("workspaces"),
    adminId: v.string(),
    action: v.union(
      v.literal("view_workspace"),
      v.literal("send_message"),
      v.literal("create_workspace"),
      v.literal("create_admin_student_workspace"),
      v.literal("create_admin_instructor_workspace"),
      v.literal("delete_workspace"),
      v.literal("update_workspace"),
      v.literal("transfer_workspace_ownership")
    ),
    details: v.optional(v.string()),
    timestamp: v.number(),
    // PR admin-onboarding #1: programmatic correlation between a workspace
    // created via admin onboarding and its `adminOnboardings` row. The
    // human-readable string stays in `details`; this field is for joins.
    adminOnboardingId: v.optional(v.id("adminOnboardings")),
  }).index("by_workspaceId", ["workspaceId"])
    .index("by_adminId", ["adminId"])
    .index("by_timestamp", ["timestamp"])
    .index("by_adminOnboardingId", ["adminOnboardingId"]),

  marketingWaitlist: defineTable({
    email: v.string(),
    instructorSlug: v.string(),
    mentorshipType: v.union(v.literal("oneOnOne"), v.literal("group")),
    notifiedAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_instructorSlug_mentorshipType", ["instructorSlug", "mentorshipType"])
    .index("by_email_instructorSlug", ["email", "instructorSlug"]),

  studentSessionCounts: defineTable({
    userId: v.string(),
    instructorId: v.id("instructors"),
    sessionCount: v.number(),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    legacyId: v.optional(v.string()),
  }).index("by_userId", ["userId"])
    .index("by_instructorId", ["instructorId"])
    .index("by_userId_instructorId", ["userId", "instructorId"]),

  contacts: defineTable({
    email: v.string(),
    artGoals: v.optional(v.string()),
    source: v.optional(v.string()),
    optedIn: v.optional(v.boolean()),
    legacyId: v.optional(v.string()),
  }).index("by_email", ["email"]),

  studentInvitations: defineTable({
    email: v.string(),
    instructorId: v.id("instructors"),
    clerkInvitationId: v.optional(v.string()),
    expiresAt: v.number(),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("expired"), v.literal("cancelled")),
    deletedAt: v.optional(v.number()),
    legacyId: v.optional(v.string()),
  }).index("by_email", ["email"])
    .index("by_instructorId", ["instructorId"])
    .index("by_status", ["status"])
    .index("by_email_instructorId", ["email", "instructorId"]),

  userIdentities: defineTable({
    userId: v.string(),
    provider: v.union(v.literal("discord")),
    providerUserId: v.string(),
    connectedAt: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    legacyId: v.optional(v.string()),
  }).index("by_userId", ["userId"])
    .index("by_provider", ["provider"])
    .index("by_providerUserId", ["providerUserId"])
    .index("by_userId_provider", ["userId", "provider"]),

  discordActionQueue: defineTable({
    type: v.union(v.literal("assign_student_role"), v.literal("dm_instructor_new_signup")),
    status: v.union(v.literal("pending"), v.literal("processing"), v.literal("done"), v.literal("failed")),
    subjectUserId: v.string(),
    instructorId: v.optional(v.string()),
    instructorUserId: v.optional(v.string()),
    payload: v.any(),
    attempts: v.optional(v.number()),
    lastError: v.optional(v.string()),
    lockedAt: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    legacyId: v.optional(v.string()),
  }).index("by_status", ["status"])
    .index("by_subjectUserId", ["subjectUserId"])
    .index("by_instructorId", ["instructorId"])
    .index("by_status_createdAt", ["status", "createdAt"]),

  videoEditorAssignments: defineTable({
    videoEditorId: v.string(),
    instructorId: v.string(),
    assignedAt: v.optional(v.number()),
    assignedBy: v.optional(v.string()),
    legacyId: v.optional(v.string()),
  }).index("by_videoEditorId", ["videoEditorId"])
    .index("by_instructorId", ["instructorId"])
    .index("by_videoEditorId_instructorId", ["videoEditorId", "instructorId"]),

  instructorUploads: defineTable({
    instructorId: v.string(),
    filename: v.string(),
    originalName: v.string(),
    contentType: v.string(),
    size: v.number(),
    b2FileId: v.optional(v.string()),
    b2UploadId: v.optional(v.string()),
    b2PartEtags: v.optional(v.string()),
    status: v.union(v.literal("pending"), v.literal("uploading"), v.literal("completed"), v.literal("archived"), v.literal("failed"), v.literal("deleted"), v.literal("deleting")),
    errorMessage: v.optional(v.string()),
    archivedAt: v.optional(v.number()),
    s3Key: v.optional(v.string()),
    s3Url: v.optional(v.string()),
    transferStatus: v.optional(v.union(v.literal("pending"), v.literal("transferring"), v.literal("completed"), v.literal("failed"))),
    transferRetryCount: v.optional(v.number()),
    notifiedAt: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
    legacyId: v.optional(v.string()),
    deleteAttemptCount: v.optional(v.number()),
    lastDeleteAttempt: v.optional(v.number()),
    uploadedById: v.optional(v.string()),
  }).index("by_instructorId", ["instructorId"])
    .index("by_status", ["status"])
    .index("by_transferStatus", ["transferStatus"])
    .index("by_createdAt", ["createdAt"])
    .index("by_status_createdAt", ["status", "createdAt"])
    .index("by_legacyId", ["legacyId"])
    .index("by_uploadedById", ["uploadedById"]),

  studentOnboardingSubmissions: defineTable({
    userId: v.string(),
    instructorId: v.id("instructors"),
    sessionPackId: v.id("sessionPacks"),
    goals: v.string(),
    imageObjects: v.optional(v.any()),
    reviewedAt: v.optional(v.number()),
    reviewedByUserId: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    legacyId: v.optional(v.string()),
  }).index("by_userId", ["userId"])
    .index("by_instructorId", ["instructorId"])
    .index("by_sessionPackId", ["sessionPackId"]),

  kajabiOffers: defineTable({
    instructorSlug: v.string(),
    type: v.union(v.literal("oneOnOne"), v.literal("group")),
    createdAt: v.optional(v.number()),
    legacyId: v.optional(v.string()),
  }).index("by_instructorSlug", ["instructorSlug"])
    .index("by_type", ["type"]),

  adminDigestSettings: defineTable({
    enabled: v.optional(v.boolean()),
    frequency: v.optional(v.union(v.literal("daily"), v.literal("weekly"), v.literal("monthly"))),
    adminEmail: v.string(),
    lastSentAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    legacyId: v.optional(v.string()),
  }),

  monthlyStorageCosts: defineTable({
    month: v.string(),
    b2StorageCost: v.optional(v.number()),
    b2DownloadCost: v.optional(v.number()),
    b2ApiCost: v.optional(v.number()),
    s3StorageCost: v.optional(v.number()),
    s3RetrievalCost: v.optional(v.number()),
    totalCost: v.optional(v.number()),
    alertSent: v.optional(v.boolean()),
    alertThreshold: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    legacyId: v.optional(v.string()),
  }).index("by_month", ["month"]),

  pendingClerkDeletions: defineTable({
    clerkUserId: v.string(),
    instructorId: v.id("instructors"),
    attempts: v.optional(v.number()),
    lastError: v.optional(v.string()),
    createdAt: v.optional(v.number()),
  }).index("by_clerkUserId", ["clerkUserId"]),

  hdInvitations: defineTable({
    email: v.string(),
    role: v.union(v.literal("student"), v.literal("instructor"), v.literal("admin"), v.literal("video_editor")),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("expired"), v.literal("cancelled")),
    clerkInvitationId: v.optional(v.string()),
    invitedByUserId: v.string(),
    expiresAt: v.number(),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  }).index("by_status", ["status"])
    .index("by_role", ["role"])
    .index("by_email", ["email"])
    .index("by_invitedByUserId", ["invitedByUserId"]),

  // PR #4c-2: in-app + email notification rows for ad-hoc call
  // invitations. One row is created when an instructor starts an
  // ad-hoc call and the student is the recipient. Deduped on
  // `(userId, sessionId)` via `by_userId_sessionId` — re-starting
  // the same call does not create a duplicate. `emailSentAt` marks
  // the idempotency token for the Resend task (Trigger.dev retries
  // can run the task repeatedly without spamming the recipient).
  // 24-hour TTL on `expiresAt` so unread badges auto-expire and do
  // not stay red forever when the student never opens them.
  inCallNotifications: defineTable({
    userId: v.string(),
    sessionId: v.id("sessions"),
    workspaceId: v.id("workspaces"),
    kind: v.literal("ad_hoc_call_invite"),
    createdAt: v.number(),
    expiresAt: v.number(),
    readAt: v.optional(v.number()),
    emailSentAt: v.optional(v.number()),
  }).index("by_userId_sessionId", ["userId", "sessionId"])
    .index("by_userId_readAt", ["userId", "readAt"])
    .index("by_sessionId", ["sessionId"])
    .index("by_workspaceId_sessionId", ["workspaceId", "sessionId"]),

  // PR admin-onboarding #1: append-only record of every Kajabi admin
  // onboarding submission. Source of truth for idempotency, state machine,
  // recovery dashboard, and per-pair renewal detection audit trail.
  adminOnboardings: defineTable({
    // Identity + provenance
    email: v.string(),                                // normalized lowercase
    flowVersion: v.number(),                          // = 1 for v1
    source: v.union(
      v.literal("kajabi"),
      v.literal("manual"),
      v.literal("import"),
      v.literal("api")
    ),
    submittedByUserId: v.string(),                    // Clerk userId of the admin who submitted

    // State machine
    status: v.union(
      v.literal("queued"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled")
    ),
    failureReason: v.optional(v.string()),
    attemptCount: v.number(),
    lastAttemptAt: v.optional(v.number()),
    cancelledAt: v.optional(v.number()),
    cancelledByUserId: v.optional(v.string()),
    completedAt: v.optional(v.number()),

    // Per-instructor assignment details. One row per pair. `isRenewal = true`
    // means the seat + workspace already existed and were reused; the
    // sessionPack/seatReservation/workspace IDs are still recorded so the
    // dashboard can link to them.
    perInstructor: v.array(v.object({
      instructorId: v.id("instructors"),
      workspaceId: v.optional(v.id("workspaces")),
      seatReservationId: v.optional(v.id("seatReservations")),
      sessionPackId: v.optional(v.id("sessionPacks")),
      isRenewal: v.boolean(),
      sessionsPerInstructor: v.number(),
      expiresAt: v.optional(v.number()),
      clerkInvitationId: v.optional(v.string()),
      capacityOverride: v.optional(v.boolean()),
    })),

    // Cross-cutting fields
    capacityOverrideReason: v.optional(v.string()),
    notes: v.optional(v.string()),
    isSeparateStudentRecord: v.boolean(),
    onboardingAlias: v.optional(v.string()),
    existingWorkspaceIds: v.array(v.id("workspaces")),

    // Append-only event history. Bounded by transitions + email sends
    // (typically <20 entries per row) — does not violate Convex's
    // no-unbounded-lists rule.
    timeline: v.array(v.object({
      at: v.number(),
      event: v.union(
        v.literal("queued"),
        v.literal("processing_started"),
        v.literal("email_sent"),
        v.literal("discord_queued"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("retrying"),
        v.literal("cancelled"),
        v.literal("capacity_override"),
        v.literal("alias_set"),
        v.literal("released")
      ),
      actorUserId: v.optional(v.string()),
      details: v.optional(v.string()),
    })),

    // Email receipts (PR 2 stub sets `stub: true`; PR 3 sets the real
    // recipient-level fields). `instructors` tracks Convex instructor IDs
    // (not userIds) of instructors who received a notification email.
    emailsSent: v.optional(v.object({
      student: v.optional(v.boolean()),
      instructors: v.optional(v.array(v.string())),    // Convex instructor IDs; v.id("instructors") widened in PR 3
      adminSummary: v.optional(v.boolean()),
      // PR 4 cloud-review fix (greptile-apps): per-address tracking so a
      // partial admin-send failure on one recipient does not block retries
      // to the failed recipient. Widened additively — legacy rows without
      // this field simply re-attempt all addresses on next run.
      adminSummaryByEmail: v.optional(v.record(v.string(), v.boolean())),
      stub: v.optional(v.boolean()),
    })),

    createdAt: v.number(),
  }).index("by_email", ["email"])
    .index("by_status", ["status"])
    .index("by_status_createdAt", ["status", "createdAt"])
    .index("by_submittedByUserId", ["submittedByUserId"])
    .index("by_onboardingAlias", ["onboardingAlias"])
    .index("by_email_source", ["email", "source"]),
});
