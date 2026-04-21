import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    email: v.string(),
    clerkId: v.optional(v.string()),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    role: v.optional(v.union(v.literal("student"), v.literal("mentor"), v.literal("admin"), v.literal("video_editor"))),
    timeZone: v.optional(v.string()),
  }).index("by_email", ["email"])
    .index("by_clerkId", ["clerkId"]),

  mentors: defineTable({
    userId: v.string(),
    googleCalendarId: v.optional(v.string()),
    googleRefreshToken: v.optional(v.string()),
    timeZone: v.optional(v.string()),
    workingHours: v.optional(v.any()),
    maxActiveStudents: v.number(),
    bio: v.optional(v.string()),
    pricing: v.optional(v.string()),
    oneOnOneInventory: v.number(),
    groupInventory: v.number(),
    deletedAt: v.optional(v.number()),
  }).index("by_userId", ["userId"])
    .index("by_deletedAt", ["deletedAt"]),

  sessions: defineTable({
    mentorId: v.id("mentors"),
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
  }).index("by_studentId", ["studentId"])
    .index("by_mentorId", ["mentorId"])
    .index("by_sessionPackId", ["sessionPackId"])
    .index("by_status", ["status"])
    .index("by_scheduledAt", ["scheduledAt"])
    .index("by_studentId_status_scheduledAt", ["studentId", "status", "scheduledAt"])
    .index("by_googleCalendarEventId", ["googleCalendarEventId"]),

  seatReservations: defineTable({
    mentorId: v.id("mentors"),
    userId: v.string(),
    sessionPackId: v.id("sessionPacks"),
    seatExpiresAt: v.number(),
    gracePeriodEndsAt: v.optional(v.number()),
    finalWarningNotificationSentAt: v.optional(v.number()),
    status: v.union(v.literal("active"), v.literal("grace"), v.literal("released")),
  }).index("by_mentorId", ["mentorId"])
    .index("by_userId", ["userId"])
    .index("by_status", ["status"])
    .index("by_seatExpiresAt", ["seatExpiresAt"])
    .index("by_mentorId_status", ["mentorId", "status"])
    .index("by_userId_mentorId", ["userId", "mentorId"])
    .index("by_sessionPackId", ["sessionPackId"]),

  sessionPacks: defineTable({
    userId: v.string(),
    mentorId: v.id("mentors"),
    totalSessions: v.number(),
    remainingSessions: v.number(),
    purchasedAt: v.number(),
    expiresAt: v.optional(v.number()),
    status: v.union(v.literal("active"), v.literal("depleted"), v.literal("expired"), v.literal("refunded")),
    paymentId: v.id("payments"),
    deletedAt: v.optional(v.number()),
  }).index("by_userId", ["userId"])
    .index("by_mentorId", ["mentorId"])
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
  }).index("by_orderId", ["orderId"])
    .index("by_status", ["status"])
    .index("by_provider_providerPaymentId", ["provider", "providerPaymentId"]),

  products: defineTable({
    mentorId: v.id("mentors"),
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
  }).index("by_mentorId", ["mentorId"])
    .index("by_stripePriceId", ["stripePriceId"])
    .index("by_active", ["active"]),

  instructors: defineTable({
    userId: v.optional(v.string()),
    mentorId: v.optional(v.string()),
    email: v.optional(v.string()),
    name: v.string(),
    slug: v.string(),
    tagline: v.optional(v.string()),
    bio: v.optional(v.string()),
    specialties: v.optional(v.array(v.string())),
    background: v.optional(v.array(v.string())),
    profileImageUrl: v.optional(v.string()),
    profileImageUploadPath: v.optional(v.string()),
    portfolioImages: v.optional(v.array(v.string())),
    socials: v.optional(v.any()),
    isActive: v.boolean(),
    isNew: v.optional(v.boolean()),
  }).index("by_slug", ["slug"])
    .index("by_userId", ["userId"])
    .index("by_email", ["email"])
    .index("by_mentorId", ["mentorId"])
    .index("by_isActive", ["isActive"]),

  instructorTestimonials: defineTable({
    instructorId: v.id("instructors"),
    name: v.string(),
    text: v.string(),
  }).index("by_instructorId", ["instructorId"]),

  menteeResults: defineTable({
    instructorId: v.id("instructors"),
    imageUrl: v.optional(v.string()),
    imageUploadPath: v.optional(v.string()),
    studentName: v.optional(v.string()),
    createdBy: v.optional(v.string()),
  }).index("by_instructorId", ["instructorId"])
    .index("by_createdBy", ["createdBy"]),

  workspaces: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    ownerId: v.string(),
    mentorId: v.optional(v.id("mentors")),
    imageUrl: v.optional(v.string()),
    isPublic: v.boolean(),
    deletedAt: v.optional(v.number()),
    seatReservationId: v.optional(v.id("seatReservations")),
    endedAt: v.optional(v.number()),
    menteeImageCount: v.number(),
    mentorImageCount: v.number(),
  }).index("by_ownerId", ["ownerId"])
    .index("by_mentorId", ["mentorId"])
    .index("by_seatReservationId", ["seatReservationId"])
    .index("by_endedAt", ["endedAt"]),

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
  }).index("by_workspaceId", ["workspaceId"])
    .index("by_userId", ["userId"]),

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

  marketingWaitlist: defineTable({
    email: v.string(),
    instructorSlug: v.string(),
    mentorshipType: v.union(v.literal("oneOnOne"), v.literal("group")),
    notifiedAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_instructorSlug_mentorshipType", ["instructorSlug", "mentorshipType"])
    .index("by_email_instructorSlug", ["email", "instructorSlug"]),
});
