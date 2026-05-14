import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    userId: v.string(),
    email: v.string(),
    clerkId: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    role: v.optional(v.union(v.literal("student"), v.literal("instructor"), v.literal("admin"), v.literal("video_editor"))),
    timeZone: v.optional(v.string()),
    legacyId: v.optional(v.string()),
  }).index("by_email", ["email"])
    .index("by_clerkId", ["clerkId"])
    .index("by_userId", ["userId"]),

  instructors: defineTable({
    userId: v.optional(v.string()),
    name: v.optional(v.string()),
    slug: v.optional(v.string()),
    email: v.optional(v.string()),
    googleCalendarId: v.optional(v.string()),
    googleRefreshToken: v.optional(v.string()),
    timeZone: v.optional(v.string()),
    workingHours: v.optional(v.any()),
    maxActiveStudents: v.optional(v.number()),
    bio: v.optional(v.string()),
    pricing: v.optional(v.string()),
    oneOnOneInventory: v.optional(v.number()),
    groupInventory: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
    legacyId: v.optional(v.string()),
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
    legacyMentorId: v.optional(v.string()),
    tagline: v.optional(v.string()),
    updatedAt: v.optional(v.number()),
  }).index("by_userId", ["userId"])
    .index("by_slug", ["slug"])
    .index("by_deletedAt", ["deletedAt"])
    .index("by_email", ["email"]),

  sessions: defineTable({
    instructorId: v.id("instructors"),
    studentId: v.string(),
    sessionPackId: v.id("sessionPacks"),
    scheduledAt: v.number(),
    completedAt: v.optional(v.number()),
    canceledAt: v.optional(v.number()),
    status: v.union(v.literal("scheduled"), v.literal("completed"), v.literal("canceled"), v.literal("no_show")),
    recordingConsent: v.boolean(),
    recordingUrl: v.optional(v.string()),
    recordingExpiresAt: v.optional(v.number()),
    googleCalendarEventId: v.optional(v.string()),
    notes: v.optional(v.string()),
    deletedAt: v.optional(v.number()),
    legacyId: v.optional(v.string()),
  }).index("by_studentId", ["studentId"])
    .index("by_instructorId", ["instructorId"])
    .index("by_sessionPackId", ["sessionPackId"])
    .index("by_status", ["status"])
    .index("by_scheduledAt", ["scheduledAt"])
    .index("by_studentId_status_scheduledAt", ["studentId", "status", "scheduledAt"])
    .index("by_googleCalendarEventId", ["googleCalendarEventId"]),

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
    paymentId: v.id("payments"),
    deletedAt: v.optional(v.number()),
    legacyId: v.optional(v.string()),
  }).index("by_userId", ["userId"])
    .index("by_instructorId", ["instructorId"])
    .index("by_status", ["status"])
    .index("by_expiresAt", ["expiresAt"])
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

  instructorProfiles: defineTable({
    userId: v.optional(v.string()),
    legacyMentorId: v.optional(v.string()),
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
    legacyId: v.optional(v.string()),
  }).index("by_slug", ["slug"])
    .index("by_userId", ["userId"])
    .index("by_email", ["email"])
    .index("by_legacyMentorId", ["legacyMentorId"])
    .index("by_isActive", ["isActive"]),

  instructorTestimonials: defineTable({
    instructorId: v.optional(v.string()), // Using string to allow legacy IDs
    name: v.string(),
    text: v.string(),
    role: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    legacyId: v.optional(v.string()),
  }).index("by_instructorId", ["instructorId"]),

  menteeResults: defineTable({
    instructorId: v.optional(v.string()), // Using string to allow legacy IDs
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
    menteeImageCount: v.number(),
    instructorImageCount: v.number(),
    type: v.optional(v.union(v.literal("mentorship"), v.literal("admin_mentee"), v.literal("admin_instructor"))),
  }).index("by_ownerId", ["ownerId"])
    .index("by_instructorId", ["instructorId"])
    .index("by_seatReservationId", ["seatReservationId"])
    .index("by_endedAt", ["endedAt"])
    .index("by_type", ["type"]),

  workspaceNotes: defineTable({
    workspaceId: v.id("workspaces"),
    title: v.string(),
    content: v.string(),
    createdBy: v.string(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
  }).index("by_workspaceId", ["workspaceId"])
    .index("by_createdBy", ["createdBy"]),

  workspaceLinks: defineTable({
    workspaceId: v.id("workspaces"),
    url: v.string(),
    title: v.optional(v.string()),
    createdBy: v.string(),
    deletedAt: v.optional(v.number()),
  }).index("by_workspaceId", ["workspaceId"]),

  workspaceImages: defineTable({
    workspaceId: v.id("workspaces"),
    imageUrl: v.string(),
    storageId: v.optional(v.string()),
    createdBy: v.string(),
    deletedAt: v.optional(v.number()),
  }).index("by_workspaceId", ["workspaceId"]),

  workspaceMessages: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.string(),
    content: v.string(),
    type: v.union(v.literal("text"), v.literal("image"), v.literal("file")),
    senderRole: v.optional(v.union(v.literal("instructor"), v.literal("student"), v.literal("admin"))),
  }).index("by_workspaceId", ["workspaceId"])
    .index("by_userId", ["userId"])
    .index("by_senderRole", ["senderRole"]),

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
      v.literal("create_admin_mentee_workspace"),
      v.literal("create_admin_instructor_workspace")
    ),
    details: v.optional(v.string()),
    timestamp: v.number(),
  }).index("by_workspaceId", ["workspaceId"])
    .index("by_adminId", ["adminId"])
    .index("by_timestamp", ["timestamp"]),

  marketingWaitlist: defineTable({
    email: v.string(),
    instructorSlug: v.string(),
    mentorshipType: v.union(v.literal("oneOnOne"), v.literal("group")),
    notifiedAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_instructorSlug_mentorshipType", ["instructorSlug", "mentorshipType"])
    .index("by_email_instructorSlug", ["email", "instructorSlug"]),

  menteeSessionCounts: defineTable({
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

  menteeInvitations: defineTable({
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
    type: v.union(v.literal("assign_mentee_role"), v.literal("dm_instructor_new_signup")),
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
    status: v.union(v.literal("pending"), v.literal("uploading"), v.literal("completed"), v.literal("archived"), v.literal("failed"), v.literal("deleted")),
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
  }).index("by_instructorId", ["instructorId"])
    .index("by_status", ["status"])
    .index("by_transferStatus", ["transferStatus"])
    .index("by_createdAt", ["createdAt"])
    .index("by_status_createdAt", ["status", "createdAt"]),

  menteeOnboardingSubmissions: defineTable({
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
});
