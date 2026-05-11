# apps/platform Implementation Guide

**Goal**: Build a fresh `apps/platform` with clean Convex-only architecture by stripping and porting from `apps/web`.

**Target**: MVP by May 11, 2026

---

## Progress Summary (Updated May 10, 2026)

### Completed ✅

1. **Phase 0 - Setup**: Created `apps/platform` from `apps/web`, cleaned package.json, created env, initialized Convex
2. **Phase 1 - Strip Code**:
   - Deleted 7 SQL-dependent Inngest functions (sync.ts, booking-emails.ts, notifications.ts, sessions.ts, clerk-user-linking.ts, clerk-user-deleted.ts, discord.ts)
   - Deleted 5 SQL-dependent lib files (db.ts, auth.ts, auth-helpers.ts, supabase-inventory.ts, inventory.ts)
   - Deleted 12 SQL-dependent API routes
   - Deleted SQL-dependent pages (admin/inventory, waitlist, dashboard/onboarding)
   - Created replacement Clerk-based `lib/auth-helpers.ts` and `lib/auth.ts`
3. **Phase 2 - Convex Schema**: Created 17-table schema in `convex/schema.ts`
4. **Phase 2 - Convex Functions**: Created:
   - `convex/instructors.ts` - CRUD operations
   - `convex/sessionPacks.ts` - Session packs with auto-create workspace
   - `convex/sessions.ts` - Session management
   - `convex/workspaces.ts` - Workspace chat/notes/images
   - `convex/storage.ts` - File upload/delete mutations
   - `convex/admin.ts` - Admin instructor creation mutations
   - `convex/products.ts`, `convex/orders.ts`, `convex/payments.ts`, `convex/users.ts`
5. **Phase 2 - React Query Hooks**: Created in `lib/queries/convex/`:
   - `use-instructors.ts` - Added `useAllInstructors` for admin
   - `use-session-packs.ts`, `use-sessions.ts`, `use-workspaces.ts`, `use-products.ts`
6. **Phase 3 - Ported Pages**:
   - ✅ Instructor listing page (`/instructors/page.tsx`)
   - ✅ Instructor profile page (`/instructors/[slug]/page.tsx`) - fully using Convex hooks
   - ✅ Admin instructors list (`/admin/instructors/page.tsx`) - using `useAllInstructors`
   - ✅ Admin instructor create page (`/admin/instructors/create/page.tsx`)
   - ✅ Student dashboard (`/dashboard/page.tsx`) - rewritten to use Convex hooks
   - ✅ Workspace page (`/workspace/page.tsx`) - using `useWorkspacesByOwner`
7. **Configuration Fixes (May 10, 2026)**:
   - ✅ Fixed `convex.config.ts` - Updated from old `defineApp` to modern `defineConfig` format
   - ✅ Fixed `convex/auth.config.ts` - Removed direct Clerk import (caused node:async_hooks bundling error), using env var pattern
   - ✅ Fixed `convex/storage.ts` - Added missing `import { v } from "convex/values"`
   - ✅ Added `CLERK_JWT_ISSUER_DOMAIN` to `.env.local`
   - ✅ Convex dev server running successfully with deployment `acoustic-kiwi-522`

### In Progress 🚧

1. **Checkout page** (`/checkout/page.tsx`) - needs updates for Convex hooks
2. **Workspace components** (chat, notes, images) - need mutation hooks in `use-workspaces.ts`
3. **Admin instructor edit page** (`/admin/instructors/[id]/edit/page.tsx`) - still uses API routes

### Blocked / Not Started ⏳

1. **Instructor-specific pages** (deferred for MVP):
   - `/instructor/dashboard/page.tsx`
   - `/instructor/profile/page.tsx`
   - `/instructor/sessions/page.tsx`
   - `/instructor/settings/page.tsx`
   - `/instructor/onboarding/page.tsx`
2. **Calendar page** (`/calendar/page.tsx`)
3. **Settings page** (`/settings/page.tsx`)
4. **Many API routes** in `/api/instructor/**` - deprecated, use Convex instead

---

## Architecture Overview

### Principles
1. **Single Source of Truth**: Convex only - no SQL/Drizzle for application data
2. **Unified Terminology**: "instructor" everywhere (no "mentor" in schema or code)
3. **Simplified Data Model**: 17 tables instead of 25+, no duplicate tables
4. **File Storage**: Convex file storage for all images (no B2/S3)

### What's Different from apps/web

| Aspect | apps/web | apps/platform |
|--------|----------|---------------|
| Databases | Convex + SQL/Drizzle (dual) | Convex only |
| Schema | 25+ tables (instructors, mentors, instructorProfiles) | 17 tables (single instructors table) |
| Sync | 8 Inngest handlers (Convex → SQL) | No sync needed |
| Terminology | "mentor" and "instructor" mixed | "instructor" only |
| File Storage | Convex + B2/S3 | Convex only |
| Seat System | seatReservations table with complex lifecycle | Direct sessionPack → workspace link |
| Kajabi | Integrated | Removed |

---

## Phase 0: Setup (Hour 0-1)

### 0.1: Create apps/platform from apps/web

```bash
# In monorepo root
cp -r apps/web apps/platform

# Navigate to platform
cd apps/platform

# Remove git (will have own repo later)
rm -rf .git

# Check directory structure
ls -la
```

### 0.2: Clean package.json dependencies

Remove or comment out SQL-related packages:

```json
// Remove these from dependencies:
"@mentorships/db": "workspace:*",
"drizzle-orm": "...",
"@types/pg": "...",

// Keep:
"convex": "...",
"@convex-dev/react-query": "...",
"stripe": "...",
"@clerk/nextjs": "...",
// etc.
```

### 0.3: Update environment setup

Create `.env.local` for `apps/platform` with:
```
# Convex
CONVEX_DEPLOYMENT=
NEXT_PUBLIC_CONVEX_URL=
CONVEX_HTTP_KEY=

# Clerk (same as web)
CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
CLERK_JWT_ISSUER_DOMAIN=

# Stripe
STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=

# PayPal
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_WEBHOOK_ID=

# Others as needed
```

### 0.4: Initialize Convex project

```bash
npx convex init

# This creates:
# - convex/schema.ts (will replace)
# - convex.config.ts (will update)
# - .gitignore update
```

---

## Phase 1: Strip Code (Hour 1-2)

### 1.1: Delete Inngest sync functions

**DELETE** `apps/platform/inngest/functions/sync.ts` - all 8 sync handlers

**DELETE** SQL-dependent Inngest functions:
- `apps/platform/inngest/functions/booking-emails.ts` (uses SQL getUserById, getMentorById)
- `apps/platform/inngest/functions/notifications.ts` (uses SQL getUserById, userIdentities)
- `apps/platform/inngest/functions/sessions.ts` (uses SQL sessions, sessionPacks, seatReservations)
- `apps/platform/inngest/functions/clerk-user-linking.ts` (uses SQL instructors, mentors, menteeInvitations)
- `apps/platform/inngest/functions/clerk-user-deleted.ts` (uses SQL instructors)
- `apps/platform/inngest/functions/discord.ts` (uses SQL claimDiscordActions, userIdentities)

**KEEP** (already Convex-based):
- `apps/platform/inngest/functions/payments.ts` (uses Convex HTTP client)
- `apps/platform/inngest/functions/onboarding.ts` (reads from Convex)
- `apps/platform/inngest/functions/inventory-sync.ts` (posts to Convex HTTP)

### 1.2: Delete SQL/Supabase utilities

**DELETE**:
- `apps/platform/lib/db.ts` (Drizzle client)
- `apps/platform/lib/auth.ts` (SQL: getUser, requireDbUser)
- `apps/platform/lib/auth-helpers.ts` (SQL: requireRole)
- `apps/platform/lib/supabase-inventory.ts` (Kajabi integration)
- `apps/platform/lib/inventory.ts` (SQL-based inventory functions)

**KEEP**:
- `apps/platform/lib/stripe.ts`
- `apps/platform/lib/google.ts`
- `apps/platform/lib/discord.ts`
- `apps/platform/lib/email.ts`
- `apps/platform/lib/utils.ts`
- `apps/platform/lib/validators.ts`

### 1.3: Delete SQL-dependent API routes

**DELETE** these routes (they use SQL/Drizzle):
- `apps/platform/app/api/admin/products/route.ts` (POST uses getAdminProducts SQL)
- `apps/platform/app/api/admin/stats/route.ts` (GET uses getAdminStats SQL)
- `apps/platform/app/api/admin/instructors/route.ts` (GET uses getAdminInstructors SQL)
- `apps/platform/app/api/admin/mentees/route.ts` (GET uses getAdminMentees SQL)
- `apps/platform/app/api/products/create-from-stripe/route.ts` (SQL + Stripe only)
- `apps/platform/app/api/sessions/route.ts` (POST uses SQL booking)
- `apps/platform/app/api/instructor/mentees/session-counts/[userId]/route.ts` (SQL functions)
- `apps/platform/app/api/instructor/onboarding/review/route.ts` (SQL)
- `apps/platform/app/api/onboarding/submit/route.ts` (SQL submissions)
- `apps/platform/app/api/onboarding/uploads/route.ts` (Supabase storage)
- `apps/platform/app/api/onboarding/submissions/[submissionId]/signed-urls/route.ts` (Supabase)
- `apps/platform/app/api/waitlist/route.ts` (Supabase marketing waitlist)

### 1.4: Update route imports

In `apps/platform/inngest/functions/` index files, remove sync handlers and SQL-dependent imports.

In `apps/platform/app/api/inngest/route.ts`, clean up imports to only include:
- `payments.ts`
- `onboarding.ts`
- `inventory-sync.ts`

### 1.5: Delete SQL-dependent pages

**DELETE** or simplify:
- `apps/platform/app/admin/inventory/page.tsx` (Supabase-based - remove for now)
- `apps/platform/app/waitlist/page.tsx` (Supabase-based - can make static)
- `apps/platform/app/dashboard/onboarding/page.tsx` (SQL/Supabase - simplify)

---

## Phase 2: New Convex Schema (Hour 2-3)

### 2.1: Define 17-table schema

Create new `apps/platform/convex/schema.ts`:

```typescript
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({

  // ===== CORE TABLES =====

  users: defineTable({
    userId: v.string(),           // Clerk user ID
    email: v.string(),
    clerkId: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    role: v.optional(v.union(
      v.literal("student"),
      v.literal("instructor"),    // Changed from "mentor"
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
    // Inventory (from mentors table)
    oneOnOneInventory: v.number(),
    groupInventory: v.number(),
    maxActiveStudents: v.number(),
    // Profile (from instructorProfiles table)
    profileImageUrl: v.optional(v.string()),
    profileImageStorageId: v.optional(v.string()),
    profileImageUploadPath: v.optional(v.string()),
    portfolioImages: v.optional(v.array(v.string())),
    portfolioImageStorageIds: v.optional(v.array(v.string())),
    // Content
    specialties: v.optional(v.array(v.string())),
    background: v.optional(v.array(v.string())),
    socials: v.optional(v.any()),
    // Settings
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
    instructorId: v.id("instructors"),     // Changed from mentorId
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
    mentorshipType: v.string(),            // "oneOnOne" or "group"
    deletedAt: v.optional(v.number()),
    legacyId: v.optional(v.string()),
  }).index("by_userId", ["userId"])
    .index("by_instructorId", ["instructorId"])
    .index("by_status", ["status"])
    .index("by_expiresAt", ["expiresAt"])
    .index("by_paymentId", ["paymentId"]),

  // Scheduled/completed sessions
  sessions: defineTable({
    instructorId: v.id("instructors"),     // Changed from mentorId
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
    instructorId: v.id("instructors"),     // Changed from mentorId (string → v.id)
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
    mentorshipType: v.string(),            // "oneOnOne" or "group"
    active: v.boolean(),
    deletedAt: v.optional(v.number()),
    legacyId: v.optional(v.string()),
  }).index("by_instructorId", ["instructorId"])
    .index("by_stripePriceId", ["stripePriceId"])
    .index("by_active", ["active"]),

  // ===== WORKSPACE TABLES =====

  // Workspace - linked DIRECTLY to sessionPack (no seat reservation)
  workspaces: defineTable({
    sessionPackId: v.id("sessionPacks"),   // Direct link (no seatReservationId)
    instructorId: v.id("instructors"),
    ownerId: v.string(),                   // Student who owns this workspace
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
    endedAt: v.optional(v.number()),       // Start 18-month retention clock
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
      v.literal("instructor"),            // Changed from "mentor"
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
    storageId: v.optional(v.string()),     // Convex storage ID
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
```

### 2.2: Update Convex functions

**CREATE** `apps/platform/convex/instructors.ts`:
- All CRUD for unified instructors table
- No more `mentorId` field - use `instructors._id` directly

**UPDATE** `apps/platform/convex/sessionPacks.ts`:
- `mentorId` → `instructorId`
- Auto-create workspace on sessionPack creation (linked directly to sessionPack)

**UPDATE** `apps/platform/convex/sessions.ts`:
- `mentorId` → `instructorId`

**UPDATE** `apps/platform/convex/workspaces.ts`:
- Remove `seatReservationId` linking
- Add `sessionPackId` direct linking
- Remove complex seat expiration logic

**UPDATE** `apps/platform/convex/products.ts`:
- `mentorId: v.string()` → `instructorId: v.id("instructors")`

**UPDATE** `apps/platform/convex/users.ts`:
- Role "mentor" → "instructor"

### 2.3: Create Convex storage functions

**CREATE** `apps/platform/convex/storage.ts`:

```typescript
import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";

// Upload instructor profile image
export const uploadProfileImage = internalMutation({
  args: {
    instructorId: v.id("instructors"),
    storageId: v.string(),
  },
  handler: async (ctx, args) => {
    const url = await ctx.storage.getUrl(args.storageId);
    await ctx.db.patch(args.instructorId, {
      profileImageUrl: url,
      profileImageStorageId: args.storageId,
    });
    return { url };
  },
});

// Upload instructor portfolio image
export const uploadPortfolioImage = internalMutation({
  args: {
    instructorId: v.id("instructors"),
    storageId: v.string(),
  },
  handler: async (ctx, args) => {
    const url = await ctx.storage.getUrl(args.storageId);
    const instructor = await ctx.db.get(args.instructorId);
    const currentImages = instructor?.portfolioImages || [];
    const currentStorageIds = instructor?.portfolioImageStorageIds || [];
    await ctx.db.patch(args.instructorId, {
      portfolioImages: [...currentImages, url],
      portfolioImageStorageIds: [...currentStorageIds, args.storageId],
    });
    return { url };
  },
});

// Delete portfolio image
export const deletePortfolioImage = internalMutation({
  args: {
    instructorId: v.id("instructors"),
    storageId: v.string(),
  },
  handler: async (ctx, args) => {
    const instructor = await ctx.db.get(args.instructorId);
    if (!instructor) return;
    await ctx.storage.delete(args.storageId);
    const newImages = instructor.portfolioImages?.filter(
      (_, i) => instructor.portfolioImageStorageIds?.[i] !== args.storageId
    ) || [];
    const newStorageIds = instructor.portfolioImageStorageIds?.filter(
      id => id !== args.storageId
    ) || [];
    await ctx.db.patch(args.instructorId, {
      portfolioImages: newImages,
      portfolioImageStorageIds: newStorageIds,
    });
  },
});

// Workspace image upload
export const uploadWorkspaceImage = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    storageId: v.string(),
    createdBy: v.string(),
  },
  handler: async (ctx, args) => {
    const url = await ctx.storage.getUrl(args.storageId);
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) throw new Error("Workspace not found");

    // Check caps
    const isMentor = args.createdBy === workspace.instructorId.toString();
    const currentCount = isMentor ? workspace.mentorImageCount : workspace.menteeImageCount;
    const cap = isMentor ? 150 : 75;

    if (currentCount >= cap) {
      await ctx.storage.delete(args.storageId);
      throw new Error(`Image cap reached (${cap})`);
    }

    // Create image record
    const imageId = await ctx.db.insert("workspaceImages", {
      workspaceId: args.workspaceId,
      imageUrl: url,
      storageId: args.storageId,
      createdBy: args.createdBy,
    });

    // Increment counter
    if (isMentor) {
      await ctx.db.patch(args.workspaceId, {
        mentorImageCount: workspace.mentorImageCount + 1,
      });
    } else {
      await ctx.db.patch(args.workspaceId, {
        menteeImageCount: workspace.menteeImageCount + 1,
      });
    }

    return { imageId, url };
  },
});

// Similar for menteeResults, instructorUploads, etc.
```

---

## Phase 3: Port Pages (Hour 4-8)

### 3.1: Port instructor listing page

**Source**: `apps/web/app/instructors/page.tsx`
**Target**: `apps/platform/app/instructors/page.tsx`

Changes:
- Query Convex `instructors.list` instead of mock data
- Update to use new instructors table fields
- Images from Convex storage (storageId → url via `ctx.storage.getUrl`)

### 3.2: Port instructor profile page

**Source**: `apps/web/app/instructors/[slug]/page.tsx`
**Target**: `apps/platform/app/instructors/[slug]/page.tsx`

Changes:
- Query `instructors.getBySlug` from Convex
- Portfolio images from Convex storage
- Products query `products.listByInstructor`

### 3.3: Port admin dashboard

**Source**: `apps/web/app/admin/instructors/page.tsx`
**Target**: `apps/platform/app/admin/instructors/page.tsx`

Changes:
- Convex queries for instructor list
- Use Convex mutations for create/update
- Image upload to Convex storage

### 3.4: Port student dashboard

**Source**: `apps/web/app/dashboard/page.tsx`
**Target**: `apps/platform/app/dashboard/page.tsx`

Changes:
- Query `sessionPacks.listByUser` from Convex
- Query `sessions.listByUser` from Convex
- Workspaces linked to sessionPack directly

### 3.5: Port workspace page

**Source**: `apps/web/app/workspace/page.tsx`
**Target**: `apps/platform/app/workspace/page.tsx`

Changes:
- Workspaces linked to sessionPack ID
- Images from Convex storage
- Simplified (no seat reservation logic)

---

## Phase 4: Terminology Cleanup (Hour 8-10)

### 4.1: Search and replace

**Pattern to find**: `mentor` (case-sensitive, whole words only)
**Replace with**: `instructor`

**Files to update** (example list - actual may vary):
- `convex/schema.ts` - Done in Phase 2
- `convex/*.ts` - All Convex function files
- `apps/platform/app/api/**/route.ts` - API routes
- `apps/platform/lib/**` - Utilities
- Type definitions and variable names

**DANGER ZONE** - Don't replace:
- "mentee" (student) - stays as-is
- "fileName" or "className" patterns
- "element" or "statement" in generic code

### 4.2: Update type definitions

In `apps/platform/lib/validators.ts` or similar:
```typescript
// Change
role: v.literal("mentor")
// To
role: v.literal("instructor")
```

In Zod schemas:
```typescript
// Change
z.enum(["student", "mentor", "admin"])
// To
z.enum(["student", "instructor", "admin"])
```

---

## Phase 5: Test & Fix (Hour 10-12)

### 5.1: Run Convex dev server

```bash
cd apps/platform
npx convex dev
```

### 5.2: Test basic functionality

1. **Landing page** - Should render without errors
2. **Instructor listing** - Query Convex, show instructors
3. **Instructor profile** - Show with images from Convex storage
4. **Admin create instructor** - Form submission creates Convex record
5. **Image upload** - Upload to Convex storage, verify URL returned
6. **Checkout flow** - Verify Stripe/PayPal still work (shouldn't need changes)

### 5.3: Fix any issues

Common issues to watch for:
- Missing imports after deletions
- Type mismatches from schema changes
- API routes still referencing deleted SQL utilities
- Inngest functions still trying to call SQL

---

## Deferred Features (Not in MVP)

These features exist in apps/web but are deferred for apps/platform MVP:

| Feature | Reason |
|---------|--------|
| Seat expiration notifications | No seat reservation system |
| 18-month workspace retention | Complex, can add later |
| Workspace exports (PDF/ZIP) | Trigger.dev task |
| Admin audit logs | Admin feature |
| Discord role management | Separate feature |
| Google Calendar OAuth per instructor | Can add later |
| Kajabi integration | Removed from platform |
| Complex admin stats (revenue aggregation) | Use Convex queries, optimize later |

---

## File Deletion Summary

### Inngest Functions to DELETE:
```
apps/platform/inngest/functions/sync.ts
apps/platform/inngest/functions/booking-emails.ts
apps/platform/inngest/functions/notifications.ts
apps/platform/inngest/functions/sessions.ts
apps/platform/inngest/functions/clerk-user-linking.ts
apps/platform/inngest/functions/clerk-user-deleted.ts
apps/platform/inngest/functions/discord.ts
```

### Utilities to DELETE:
```
apps/platform/lib/db.ts
apps/platform/lib/auth.ts
apps/platform/lib/auth-helpers.ts
apps/platform/lib/supabase-inventory.ts
apps/platform/lib/inventory.ts
```

### API Routes to DELETE:
```
apps/platform/app/api/admin/products/route.ts (POST)
apps/platform/app/api/admin/stats/route.ts
apps/platform/app/api/admin/instructors/route.ts (GET)
apps/platform/app/api/admin/mentees/route.ts (GET)
apps/platform/app/api/products/create-from-stripe/route.ts
apps/platform/app/api/sessions/route.ts (POST)
apps/platform/app/api/instructor/mentees/session-counts/[userId]/route.ts
apps/platform/app/api/instructor/onboarding/review/route.ts
apps/platform/app/api/onboarding/submit/route.ts
apps/platform/app/api/onboarding/uploads/route.ts
apps/platform/app/api/onboarding/submissions/[submissionId]/signed-urls/route.ts
apps/platform/app/api/waitlist/route.ts
```

### Pages to DELETE or Simplify:
```
apps/platform/app/admin/inventory/page.tsx (delete - Supabase-based)
apps/platform/app/waitlist/page.tsx (simplify - make static)
apps/platform/app/dashboard/onboarding/page.tsx (simplify)
```

---

## Schema Summary (17 Tables)

### Core (8):
1. `users` - Clerk users
2. `instructors` - ALL instructor data (merged mentors + instructorProfiles)
3. `sessionPacks` - Purchased packs (links student, instructor, payment)
4. `sessions` - Scheduled/completed sessions
5. `orders` - Purchase orders
6. `payments` - Payment records
7. `products` - Mentorship offerings
8. `workspaces` - Chat/note spaces (linked to sessionPack directly)

### Workspace (4):
9. `workspaceMessages` - Real-time chat
10. `workspaceNotes` - Notes
11. `workspaceLinks` - Shared links
12. `workspaceImages` - Images (Convex storage)

### Supporting (5):
13. `instructorTestimonials` - Reviews
14. `menteeResults` - Student work showcase
15. `instructorUploads` - Upload tracking
16. `contacts` - Marketing leads
17. `menteeInvitations` - Student invites

---

## Key Changes from apps/web

### Terminology:
- `mentorId` → `instructorId` everywhere
- `mentors` table → deleted (merged into `instructors`)
- `instructorProfiles` table → deleted (merged into `instructors`)
- `users.role: "mentor"` → `"instructor"`

### Data Model:
- `seatReservations` table → deleted
- `workspaces.seatReservationId` → `workspaces.sessionPackId`
- `products.mentorId` (string) → `products.instructorId` (v.id("instructors"))

### File Storage:
- All images → Convex file storage
- No B2/S3 for this app (only for Huckleberry Drive)

### Payments:
- Keep Stripe/PayPal checkout flow
- Convex mutations for orders, payments, sessionPacks
- Trigger.dev for scheduled tasks
- Inngest for webhooks (Stripe, PayPal, Clerk)

---

## Next Action Items (Priority Order)

### P0 - Critical for MVP

1. **Fix checkout page** (`/checkout/page.tsx`)
   - Use `useInstructorBySlug` instead of `usePublicInstructorBySlug`
   - Use `useProductsByInstructor` instead of `useProductsByMentorId`
   - Add type annotations for products

2. **Add mutation hooks to use-workspaces.ts**
   - `useCreateWorkspaceMessage` → export `useWorkspaceMessages` with mutation
   - `useCreateWorkspaceNote`, `useUpdateWorkspaceNote`, `useDeleteWorkspaceNote`
   - `useCreateWorkspaceImage`, `useDeleteWorkspaceImage`
   - `useCreateWorkspaceExport`, `useWorkspaceExports`

3. **Update workspace components** to use new hooks:
   - `components/workspace/chat.tsx`
   - `components/workspace/notes.tsx`
   - `components/workspace/images.tsx`

4. **Update retention-warning-banner.tsx** with proper hooks

### P1 - Important for MVP

5. **Fix admin instructor edit page** (`/admin/instructors/[id]/edit/page.tsx`)
   - Convert from API routes to Convex mutations
   - Use `instructors:update` mutation
   - Use `instructors:createTestimonial`, `instructors:deleteTestimonial`
   - Use `instructors:createMenteeResult`, `instructors:deleteMenteeResult`

6. **Add instructor pages to use-instructors.ts**:
   - `useInstructorByUserId` - get instructor by Clerk user ID

7. **Fix landing page components** that reference old hooks:
   - `components/landing-preview/instructor-showcase.tsx`
   - `components/landing/instructor-carousel.tsx`

8. **Fix settings components**:
   - `components/settings/timezone-selector.tsx` - needs `useCurrentUser`, `useUpdateUser`

### P2 - Nice to Have (Post-MVP)

9. **Delete remaining instructor API routes** in `/api/instructor/**`
10. **Update calendar page** (`/calendar/page.tsx`)
11. **Port instructor-specific pages** when ready
12. **Add workspace exports** (PDF/ZIP generation)
13. **Add admin audit logs**

### TypeScript Errors to Fix

Run `npx tsc --noEmit -p apps/platform/tsconfig.json` to see remaining errors. Key patterns:
- `"mentor"` → `"instructor"` in role checks
- `requireRole` → use Clerk's `useUser()` with metadata check
- `getDbUser` → use Clerk's `useUser()` directly
- String mutation names → use typed mutation references
- Implicit `any` types → add explicit type annotations