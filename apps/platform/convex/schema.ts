import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // ===== CORE TABLES =====

  users: defineTable({
    userId: v.string(),
    email: v.string(),
    clerkId: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    role: v.optional(v.union(
      v.literal("student"),
      v.literal("instructor"),
      v.literal("admin"),
      v.literal("video_editor")
    )),
    timeZone: v.optional(v.string()),
    legacyId: v.optional(v.string()),
  }).index("by_email", ["email"])
    .index("by_clerkId", ["clerkId"])
    .index("by_userId", ["userId"]),

  // UNIFIED instructor table - replaces mentors + instructorProfiles
  instructors: defineTable({
    userId: v.optional(v.string()),
    name: v.string(),
    slug: v.string(),
    email: v.optional(v.string()),
    bio: v.optional(v.string()),
    tagline: v.optional(v.string()),
    // Inventory
    oneOnOneInventory: v.number(),
    groupInventory: v.number(),
    maxActiveStudents: v.number(),
    // Profile images
    profileImageUrl: v.optional(v.string()),
    profileImageStorageId: v.optional(v.string()),
    profileImageUploadPath: v.optional(v.string()),
    portfolioImages: v.optional(v.array(v.string())),
    portfolioImageStorageIds: v.optional(v.array(v.string())),
    // Content
    specialties: v.optional(v.array(v.string())),
    background: v.optional(v.array(v.string())),
    socials: v.optional(v.any()),
    // Google Calendar settings
    googleCalendarId: v.optional(v.string()),
    googleRefreshToken: v.optional(v.string()),
    timeZone: v.optional(v.string()),
    workingHours: v.optional(v.any()),
    // Status
    isActive: v.boolean(),
    isNew: v.optional(v.boolean()),
    deletedAt: v.optional(v.number()),
    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
    legacyId: v.optional(v.string()),
  }).index("by_userId", ["userId"])
    .index("by_slug", ["slug"])
    .index("by_email", ["email"])
    .index("by_isActive", ["isActive"]),

  // Purchased mentorship bundles
  sessionPacks: defineTable({
    userId: v.string(),
    instructorId: v.id("instructors"),
    totalSessions: v.number(),
    remainingSessions: v.number(),
    purchasedAt: v.number(),
    expiresAt: v.optional(v.number()),
    status: v.union(
      v.literal("active"),
      v.literal("depleted"),
      v.literal("expired"),
      v.literal("refunded")
    ),
    paymentId: v.id("payments"),
    mentorshipType: v.string(),
    deletedAt: v.optional(v.number()),
    legacyId: v.optional(v.string()),
  }).index("by_userId", ["userId"])
    .index("by_instructorId", ["instructorId"])
    .index("by_status", ["status"])
    .index("by_expiresAt", ["expiresAt"])
    .index("by_paymentId", ["paymentId"]),

  // Scheduled/completed sessions
  sessions: defineTable({
    instructorId: v.id("instructors"),
    studentId: v.string(),
    sessionPackId: v.id("sessionPacks"),
    scheduledAt: v.number(),
    completedAt: v.optional(v.number()),
    canceledAt: v.optional(v.number()),
    status: v.union(
      v.literal("scheduled"),
      v.literal("completed"),
      v.literal("canceled"),
      v.literal("no_show")
    ),
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
    .index("by_scheduledAt", ["scheduledAt"]),

  // Purchase orders
  orders: defineTable({
    userId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("paid"),
      v.literal("refunded"),
      v.literal("failed"),
      v.literal("canceled")
    ),
    provider: v.union(v.literal("stripe"), v.literal("paypal")),
    totalAmount: v.string(),
    currency: v.string(),
    deletedAt: v.optional(v.number()),
    legacyId: v.optional(v.string()),
  }).index("by_userId", ["userId"])
    .index("by_status", ["status"]),

  // Payment records
  payments: defineTable({
    orderId: v.id("orders"),
    provider: v.union(v.literal("stripe"), v.literal("paypal")),
    providerPaymentId: v.string(),
    amount: v.string(),
    currency: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("completed"),
      v.literal("refunded"),
      v.literal("failed")
    ),
    refundedAmount: v.optional(v.string()),
    deletedAt: v.optional(v.number()),
    legacyId: v.optional(v.string()),
  }).index("by_orderId", ["orderId"])
    .index("by_status", ["status"])
    .index("by_provider_providerPaymentId", ["provider", "providerPaymentId"]),

  // Mentorship offerings
  products: defineTable({
    instructorId: v.id("instructors"),
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

  // ===== WORKSPACE TABLES =====

  // Workspace - linked DIRECTLY to sessionPack
  workspaces: defineTable({
    sessionPackId: v.id("sessionPacks"),
    instructorId: v.id("instructors"),
    ownerId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    isPublic: v.boolean(),
    type: v.optional(v.union(
      v.literal("mentorship"),
      v.literal("admin_mentee"),
      v.literal("admin_instructor")
    )),
    menteeImageCount: v.number(),
    mentorImageCount: v.number(),
    endedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
  }).index("by_sessionPackId", ["sessionPackId"])
    .index("by_instructorId", ["instructorId"])
    .index("by_ownerId", ["ownerId"])
    .index("by_endedAt", ["endedAt"])
    .index("by_type", ["type"]),

  workspaceMessages: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.string(),
    content: v.string(),
    type: v.union(v.literal("text"), v.literal("image"), v.literal("file")),
    senderRole: v.optional(v.union(
      v.literal("instructor"),
      v.literal("mentee"),
      v.literal("admin")
    )),
  }).index("by_workspaceId", ["workspaceId"])
    .index("by_userId", ["userId"])
    .index("by_senderRole", ["senderRole"]),

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

  // ===== SUPPORTING TABLES =====

  instructorTestimonials: defineTable({
    instructorId: v.id("instructors"),
    name: v.string(),
    text: v.string(),
    role: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    legacyId: v.optional(v.string()),
  }).index("by_instructorId", ["instructorId"]),

  menteeResults: defineTable({
    instructorId: v.id("instructors"),
    imageUrl: v.optional(v.string()),
    imageStorageId: v.optional(v.string()),
    imageUploadPath: v.optional(v.string()),
    studentName: v.optional(v.string()),
    createdBy: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    legacyId: v.optional(v.string()),
  }).index("by_instructorId", ["instructorId"])
    .index("by_createdBy", ["createdBy"]),

  instructorUploads: defineTable({
    instructorId: v.id("instructors"),
    filename: v.string(),
    originalName: v.string(),
    contentType: v.string(),
    size: v.number(),
    storageId: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("uploading"),
      v.literal("completed"),
      v.literal("archived"),
      v.literal("failed"),
      v.literal("deleted")
    ),
    errorMessage: v.optional(v.string()),
    s3Key: v.optional(v.string()),
    s3Url: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
    legacyId: v.optional(v.string()),
  }).index("by_instructorId", ["instructorId"])
    .index("by_status", ["status"])
    .index("by_createdAt", ["createdAt"]),

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
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("expired"),
      v.literal("cancelled")
    ),
    deletedAt: v.optional(v.number()),
    legacyId: v.optional(v.string()),
  }).index("by_email", ["email"])
    .index("by_instructorId", ["instructorId"])
    .index("by_status", ["status"]),
});